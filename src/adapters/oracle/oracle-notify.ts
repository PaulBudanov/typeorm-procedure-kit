import { randomUUID } from 'crypto';

import oracledb from 'oracledb';
import type { DataSource } from 'typeorm';

import type {
  ILoggerModule,
  IOracleNotifyMsg,
  IOracleOptionsNotify,
} from '../../types.js';
import { delay } from '../../utils/delay.js';
import { errorCodeCatcherSql } from '../../utils/errorCodeCatcherSql.js';

import { OracleConnection } from './oracle-connection.js';
import { OracleSqlCommand } from './oracle-sql.js';

export class OracleNotify extends OracleConnection {
  private notificationPool = new Map<string, oracledb.Connection>();

  /**
   * Constructor for OracleNotify class.
   * Initializes the OracleNotify object with the provided configuration
   * and logger. Also sets up a listener for the 'beforeExit' event
   * to handle the application exit and release all connections from the pool.
   * @param {DataSource} appDataSource - configuration for the Oracle connection
   * @param {ILoggerModule} logger - logger module to log messages
   * @param {number} notifyPort - port number for the notification listener
   */
  protected constructor(
    protected appDataSource: DataSource,
    protected logger: ILoggerModule,
    protected notifyPort: number,
  ) {
    super(appDataSource, logger);
    process.on('beforeExit', () => void this.handleApplicationExit());
  }
  /**
   * Gets the SQL command to fetch the packages that were updated in the database
   * @param {Array<string>} packages - names of the packages to fetch
   * @returns {string} - SQL command to fetch the packages that were updated in the database
   * @example
   * const notifySql = dataBase.getNotifySql(['PACKAGE_NAME_1', 'PACKAGE_NAME_2']);
   */
  public getNotifySql(packages: Array<string>): string {
    const packageConditions = packages
      .map((pkg) => `NAME = '${pkg.toUpperCase()}'`)
      .join(' OR ');
    return OracleSqlCommand.SQL_GET_NOTIFY_UPDATE_PACKAGE.replace(
      ':REPLACER_PACKAGES',
      packageConditions,
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
    isTimedOut = false,
  ): Promise<void> {
    const connection = this.notificationPool.get(channelName);
    this.notificationPool.delete(channelName);
    if (!connection) {
      this.logger.warn(`No active subscription for channel: ${channelName}`);
      return;
    }

    if (isTimedOut) {
      this.logger.warn(`Timed out subscription for channel: ${channelName}`);
      await this.closeSingleConnection(connection);
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
        (error as Error).stack,
      );
    } finally {
      await this.closeSingleConnection(connection);
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
    notifyCallback: (args: T) => Promise<void> | void,
    options: IOracleOptionsNotify,
  ): Promise<string> {
    const channelName = randomUUID();
    const connection = await this.createSingleConnection();
    if (Array.isArray(options.operations)) {
      if (options.operations.length >= 4)
        throw new Error(
          'Operations length must be less than 4, use opcode for all operations:  oracledb.CQN_OPCODE_ALL_OPS,',
        );
      const subscriptions = await Promise.all(
        options.operations.map((operation) => {
          const modifyOptions = {
            ...options,
            operations: operation,
          };
          const subscribeOptions: oracledb.SubscribeOptions = {
            sql: sqlCommand,
            clientInitiated: false,
            timeout: 60 * 60 * 12,
            qos:
              oracledb.SUBSCR_QOS_QUERY |
              oracledb.SUBSCR_QOS_ROWIDS |
              oracledb.SUBSCR_QOS_RELIABLE, // = 13 (1 + 4 + 8)
            port: this.notifyPort, // Listener port for CQN
            callback: (msg: oracledb.SubscriptionMessage) =>
              void this.makeSubscriptionHandler(
                notifyCallback,
                connection,
                channelName,
                subscribeOptions,
                msg,
              ),
            ...modifyOptions,
          };
          return this.subscribe(connection, channelName, subscribeOptions);
        }),
      );
      return subscriptions.join(', ');
    } else {
      const subscribeOptions: oracledb.SubscribeOptions = {
        sql: sqlCommand,
        clientInitiated: false,
        timeout: 60 * 60 * 12,
        qos:
          oracledb.SUBSCR_QOS_QUERY |
          oracledb.SUBSCR_QOS_ROWIDS |
          oracledb.SUBSCR_QOS_RELIABLE, // = 13 (1 + 4 + 8)
        port: this.notifyPort, // Listener port for CQN
        callback: (msg: oracledb.SubscriptionMessage) =>
          void this.makeSubscriptionHandler(
            notifyCallback,
            connection,
            channelName,
            subscribeOptions,
            msg,
          ),
        ...options,
        operations: options.operations,
      };

      return this.subscribe(connection, channelName, subscribeOptions);
    }
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
    subscribeOptions: oracledb.SubscribeOptions,
  ): Promise<string> {
    try {
      await connection.subscribe(channelName, subscribeOptions);
      this.notificationPool.set(channelName, connection);
      this.logger.log(
        `Successfully registered subscription for channel: ${channelName}`,
      );
      return channelName;
    } catch (error) {
      this.logger.error(
        `Subscription error: ${(error as Error).message}`,
        (error as Error).stack,
      );
      await this.closeSingleConnection(connection);
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
    notifyCallback: (args: T) => Promise<void> | void,
    client: oracledb.Connection,
    channelName: string,
    subscribeUnionOptions: Omit<oracledb.SubscribeOptions, 'callback'>,
    msg: IOracleNotifyMsg,
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
          options,
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
          ', ',
        )})`;
        const result = await client.execute<T>(
          sqlQuery,
          {},
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: true,
          },
        );
        const rows = result.rows as T;
        try {
          errorCodeCatcherSql<T>(rows);
          await notifyCallback(rows);
        } catch (error) {
          this.logger.error(
            `Unhandled callback error: ${(error as Error).message}`,
            (error as Error).stack,
          );
          throw error;
        }
        return;
      }
    } catch (error) {
      this.logger.error(
        `Subscription error: ${(error as Error).message}`,
        (error as Error).stack,
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
    notifyCallback: (args: T) => Promise<void> | void,
    options: IOracleOptionsNotify,
    maxRetries = 5,
    retryDelayMs = 1000 * 60 * 5,
    currentRetry = 1,
  ): Promise<void> {
    try {
      await this.unlistenNotify(channelName, true);
      await this.listenNotify(sqlCommand, notifyCallback, options);
      this.logger.log(
        `Successfully restored subscription for sqlCommand: ${sqlCommand}`,
      );
      return;
    } catch (error) {
      this.logger.error(
        `Attempt ${currentRetry}/${maxRetries} failed to restore subscription for channel "${channelName}": ${
          (error as Error).message
        }`,
        (error as Error).stack,
      );
      if (currentRetry < maxRetries) {
        this.logger.warn(
          `Retrying in ${retryDelayMs / 1000} seconds... (Attempt ${
            currentRetry + 1
          }/${maxRetries})`,
        );
        await delay(retryDelayMs);
        return void this.restoreSubscription(
          sqlCommand,
          channelName,
          notifyCallback,
          options,
          maxRetries,
          retryDelayMs,
          currentRetry + 1,
        );
      }
      this.logger.error(
        `Max retry attempts (${maxRetries}) exceeded for channel: ${channelName}. Scheduling recovery in 30 minutes.`,
      );
      await delay(1000 * 60 * 30);
      return void this.restoreSubscription(
        sqlCommand,
        channelName,
        notifyCallback,
        options,
        maxRetries,
        retryDelayMs,
        1,
      );
    }
  }

  /**
   * Handles application exit by unsubscribing from all registered channels
   * and then closing the corresponding client connections
   * @returns {Promise<void>} - resolves when all channels are unsubscribed
   * and the client connections are closed
   */
  private async handleApplicationExit(): Promise<void> {
    if (this.notificationPool.size === 0) return;

    for (const [channel] of this.notificationPool.entries()) {
      try {
        await this.unlistenNotify(channel);
        this.logger.log(
          `Unsubscribed and closed connection for channel: ${channel}`,
        );
      } catch (err) {
        this.logger.error(
          `Error unsubscribing/closing channel ${channel}: ${
            (err as Error).message
          }`,
        );
      }
    }
  }
}
