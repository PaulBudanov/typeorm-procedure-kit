import { randomUUID } from 'crypto';

import oracledb from 'oracledb';

import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  IOracleNotifyMsg,
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
  TOracleNormilizeOptionsNotify,
} from '../../types/notification.types.js';
import { AsyncUtils } from '../../utils/async-utils.js';
import { DatabaseErrorHandler } from '../../utils/database-error-handler.js';
import { DatabaseNotify } from '../abstract/database-notify.js';

import { OracleConnection } from './oracle-connection.js';
import { OracleSqlCommand } from './oracle-sql.js';

export class OracleNotify extends DatabaseNotify<oracledb.Connection> {
  /**
   * Constructor for OracleNotify class.
   * Initializes the OracleNotify object with the provided configuration
   * and logger.
   * @param {OracleConnection} oracleConnection - configuration for the Oracle connection
   * @param {ILoggerModule} logger - logger module to log messages
   * @param {number} [notifyPort] - port number used for notify operations
   */
  public constructor(
    private readonly oracleConnection: OracleConnection,
    protected readonly logger: ILoggerModule,
    private readonly notifyPort?: number
  ) {
    super(logger);
  }
  /**
   * Gets the SQL command to fetch the packages that were updated in the database
   * @param {Array<string>} packages - names of the packages to fetch
   * @returns {string} - SQL command to fetch the packages that were updated in the database
   * @example
   * const notifySql = dataBase.getPackagesNotifySql(['PACKAGE_NAME_1', 'PACKAGE_NAME_2']);
   */
  public getPackagesNotifySql(packages: Array<string>): string {
    const packageConditions = packages
      .map((pkg) => `NAME = '${pkg.toUpperCase()}'`)
      .join(' OR ');
    return OracleSqlCommand.SQL_GET_NOTIFY_UPDATE_PACKAGE.replace(
      ':REPLACER_PACKAGES',
      packageConditions
    );
  }
  /**
   * Unsubscribes from a channel and then closes the client connection.
   * If `isTimedOut` is true, it will log a warning and then close the connection without unsubscribing first.
   * @param {string} channelName - name of the channel to unsubscribe from
   * @param {boolean} [isTimedOut=false] - whether to log a warning and then close the connection without unsubscribing first
   * @returns {Promise<void>} - resolves when the subscription is unsubscribed and the connection is closed
   */
  public async unlistenNotify(
    channelName: string,
    isTimedOut = false
  ): Promise<void> {
    const connection = this.notificationPool.get(channelName);
    this.notificationPool.delete(channelName);
    if (!connection) {
      this.logger.warn(`No active subscription for channel: ${channelName}`);
      return;
    }

    if (isTimedOut) {
      this.logger.warn(`Timed out subscription for channel: ${channelName}`);
      await this.oracleConnection.closeSingleConnection(connection);
      return;
    }

    try {
      await connection.unsubscribe(channelName);
      this.logger.log(`Unsubscribed from channel: ${channelName}`);
    } catch (error) {
      this.logger.error(
        `Error unsubscribing from channel ${channelName}: ${
          (error as Error).message
        }`,
        (error as Error).stack
      );
    } finally {
      await this.oracleConnection.closeSingleConnection(connection);
    }
  }
  //TODO: Make return object more informative
  /**
   * Registers a notification listener for a given channel
   * @param {string} sqlCommand - SQL command to listen to
   * @param {(args: T) => Promise<void> | void} notifyCallback - callback function to call when a notification is received
   * @param {IOracleOptionsNotify} options - options for the subscription
   * @returns {Promise<string>} - promise that resolves with the name of the channel that was subscribed to
   * @throws {Error} - if the SQL command does not contain LISTEN or if the listener for the channel is already registered
   */
  public async listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: IOracleOptionsNotify
  ): Promise<string> {
    const channelName = randomUUID();
    const connection = await this.oracleConnection.createSingleConnection();
    if (Array.isArray(options.operations)) {
      if (options.operations.length >= 4)
        throw new Error(
          'Operations length must be less than 4, use opcode for all operations:  oracledb.CQN_OPCODE_ALL_OPS,'
        );
      const subscriptions = await Promise.all(
        options.operations.map((operation) => {
          const modifyOptions: TOracleNormilizeOptionsNotify = {
            ...options,
            operations: operation,
          };
          return this.subscribe(
            connection,
            channelName,
            this.generateOptions(
              notifyCallback,
              modifyOptions,
              sqlCommand,
              channelName,
              connection
            )
          );
        })
      );
      return subscriptions.join(', ');
    } else {
      return this.subscribe(
        connection,
        channelName,
        this.generateOptions<T>(
          notifyCallback,
          options as TOracleNormilizeOptionsNotify,
          sqlCommand,
          channelName,
          connection
        )
      );
    }
  }

  private generateOptions<T>(
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    settings: TOracleNormilizeOptionsNotify,
    sql: string,
    channelName: string,
    connection: oracledb.Connection
  ): oracledb.SubscribeOptions {
    const subscribeOptions = {
      sql,
      clientInitiated: settings.clientInitiated ?? false,
      timeout: settings.timeout ?? 60 * 60 * 12,
      operations: settings.operations ?? oracledb.CQN_OPCODE_ALL_OPS,
      qos: settings.qos ?? oracledb.SUBSCR_QOS_ROWIDS,
      port: this.notifyPort, // Listener port for CQN
      callback: (msg: oracledb.SubscriptionMessage): Promise<void> =>
        this.makeSubscriptionHandler(
          notifyCallback,
          connection,
          channelName,
          subscribeOptions,
          msg
        ),
    };
    return subscribeOptions;
  }
  /**
   * Subscribe to a channel
   * @param {oracledb.Connection} connection - connection to Oracle database
   * @param {string} channelName - name of the channel to subscribe to
   * @param {oracledb.SubscribeOptions} subscribeOptions - options for the subscription
   * @returns {Promise<string>} - name of the channel that was subscribed to
   * @throws {Error} - if the subscription fails
   */
  private async subscribe(
    connection: oracledb.Connection,
    channelName: string,
    subscribeOptions: oracledb.SubscribeOptions
  ): Promise<string> {
    try {
      await connection.subscribe(channelName, subscribeOptions);
      this.notificationPool.set(channelName, connection);
      this.logger.log(
        `Successfully registered subscription for channel: ${channelName}`
      );
      return channelName;
    } catch (error) {
      this.logger.error(
        `Subscription error: ${(error as Error).message}`,
        (error as Error).stack
      );
      await this.oracleConnection.closeSingleConnection(connection);
      throw error;
    }
  }

  /**
   * Handles Oracle subscription message.
   * If the subscription message is of type shutdown, register, or deregister, it will restore the subscription.
   * If the subscription message is of type change, it will execute a query to get the updated rows and call the notifyCallback with the result.
   * @param notifyCallback - callback to call when the subscription message is of type change
   * @param client - Oracle connectioncreateSingleConnection
   * @param channelName - name of the channel
   * @param subscribeUnionOptions - options for Oracle subscription
   * @param msg - Oracle subscription message
   * @returns Promise<void> - resolves when the subscription message is handled
   */
  private async makeSubscriptionHandler<T>(
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    client: oracledb.Connection,
    channelName: string,
    subscribeUnionOptions: Omit<oracledb.SubscribeOptions, 'callback'>,
    msg: IOracleNotifyMsg
  ): Promise<void> {
    const options: IOracleOptionsNotify = {
      operations: subscribeUnionOptions.operations,
      qos: subscribeUnionOptions.qos,
      timeout: subscribeUnionOptions.timeout,
    };
    try {
      if (
        (msg.type === oracledb.SUBSCR_EVENT_TYPE_DEREG ||
          msg.type === oracledb.SUBSCR_EVENT_TYPE_SHUTDOWN_ANY ||
          msg.type === oracledb.SUBSCR_EVENT_TYPE_SHUTDOWN) &&
        !msg.registered
      ) {
        return void this.restoreSubscription<T>(
          subscribeUnionOptions.sql,
          channelName,
          notifyCallback,
          options
        );
      }
      const tables: Array<oracledb.SubscriptionTable> | undefined = msg
        .queries?.[0]
        ? msg.queries[0].tables
        : msg.tables;
      if (!tables || tables.length < 1) {
        this.logger.warn('No tables found in subscription message');
        return;
      }
      const affectedTables = new Map<string, Array<string>>();
      tables.forEach((table) => {
        const { name, rows } = table;
        const tableEntry = affectedTables.get(name) ?? new Array<string>();
        rows?.forEach(({ rowid }) => tableEntry.push(`'${rowid}'`));
        affectedTables.set(name, tableEntry);
      });
      for (const messageTable of affectedTables) {
        const [tableName, rowsArray] = messageTable;
        const sqlQuery = `SELECT * FROM ${tableName} WHERE rowid IN (${rowsArray.join(
          ', '
        )})`;
        const result = await client.execute<T>(
          sqlQuery,
          {},
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: true,
          }
        );
        const rows = result.rows as TNotifyCallbackGeneric<T>;
        try {
          DatabaseErrorHandler.checkForDatabaseError<T>(rows);
          await notifyCallback(rows);
        } catch (error) {
          this.logger.error(
            `Unhandled callback error: ${(error as Error).message}`,
            (error as Error).stack
          );
          throw error;
        }
        return;
      }
    } catch (error) {
      this.logger.error(
        `Subscription error: ${(error as Error).message}`,
        (error as Error).stack
      );
      return;
    }
  }

  /**
   * Attempts to restore a subscription for a given channel by unregistering
   * the channel and then registering it again. If the attempt fails, it
   * will retry after a certain delay up to a maximum number of retries.
   * If the maximum number of retries is reached, it will wait for 30 minutes
   * and then attempt to restore the subscription again.
   * @param {string} sqlCommand - SQL command to listen to
   * @param {string} channelName - name of the channel to restore
   * @param {(args: TNotifyCallbackGeneric<T>) => void | Promise<void>} notifyCallback - callback
   * to be registered for the channel
   * @param {number} [maxRetries=5] - maximum number of retries
   * @param {number} [retryDelayMs=1000 * 60 * 5] - delay in milliseconds between retries
   * @param {number} [currentRetry=1] - current retry attempt
   * @returns {Promise<void>} - resolves when the subscription is restored
   */
  private async restoreSubscription<T>(
    sqlCommand: string,
    channelName: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: IOracleOptionsNotify,
    maxRetries = 5,
    retryDelayMs = 1000 * 60 * 5,
    currentRetry = 1
  ): Promise<void> {
    try {
      await this.unlistenNotify(channelName, true);
      await this.listenNotify(sqlCommand, notifyCallback, options);
      this.logger.log(
        `Successfully restored subscription for sqlCommand: ${sqlCommand}`
      );
      return;
    } catch (error) {
      this.logger.error(
        `Attempt ${currentRetry}/${maxRetries} failed to restore subscription for channel "${channelName}": ${
          (error as Error).message
        }`,
        (error as Error).stack
      );
      if (currentRetry < maxRetries) {
        this.logger.warn(
          `Retrying in ${retryDelayMs / 1000} seconds... (Attempt ${
            currentRetry + 1
          }/${maxRetries})`
        );
        await AsyncUtils.delay(retryDelayMs);
        return void this.restoreSubscription(
          sqlCommand,
          channelName,
          notifyCallback,
          options,
          maxRetries,
          retryDelayMs,
          currentRetry + 1
        );
      }
      this.logger.error(
        `Max retry attempts (${maxRetries}) exceeded for channel: ${channelName}. Scheduling recovery in 30 minutes.`
      );
      await AsyncUtils.delay(1000 * 60 * 30);
      return void this.restoreSubscription(
        sqlCommand,
        channelName,
        notifyCallback,
        options,
        maxRetries,
        retryDelayMs,
        1
      );
    }
  }
}
