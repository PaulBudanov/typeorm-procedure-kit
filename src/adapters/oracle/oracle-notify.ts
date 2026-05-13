import { randomUUID } from 'crypto';

import oracledb from 'oracledb';

import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  INotifyOracleDefaultSettings,
  IOracleNotifyMsg,
  IOracleNotifyRestoreSettings,
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
  TOracleNormilizeOptionsNotify,
} from '../../types/notification.types.js';
import { DatabaseErrorHandler } from '../../utils/database-error-handler.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { DatabaseNotify } from '../abstract/database-notify.js';

import { OracleConnection } from './oracle-connection.js';
import { OracleSqlCommand } from './oracle-sql.js';

export class OracleNotify extends DatabaseNotify<
  oracledb.Connection,
  IOracleOptionsNotify
> {
  /**
   * Constructor for OracleNotify class.
   * Initializes the OracleNotify object with the provided configuration
   * and logger.
   * @param {OracleConnection} oracleConnection - configuration for the Oracle connection
   * @param {ILoggerModule} logger - logger module to log messages
   * @param {INotifyOracleDefaultSettings} [notifySettings] - default settings for notifications
   */
  public constructor(
    private readonly oracleConnection: OracleConnection,
    protected readonly logger: ILoggerModule,
    private readonly notifySettings: INotifyOracleDefaultSettings
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
      .map(
        (pkg) =>
          `NAME = '${SqlIdentifier.validateIdentifier(
            pkg,
            'oracle package notification'
          ).toUpperCase()}'`
      )
      .join(' OR ');
    return OracleSqlCommand.SQL_GET_NOTIFY_UPDATE_PACKAGE.replace(
      ':REPLACER_PACKAGES',
      packageConditions
    );
  }
  /**
   * Unsubscribes from a channel and then closes the client connection.
   * @param {string} channelName - name of the channel to unsubscribe from
   * @returns {Promise<void>} - resolves when the subscription is unsubscribed and the connection is closed
   */
  public override async unlistenNotify(channelName: string): Promise<void> {
    this.cancelNotificationRestore(channelName);
    const connection = this.notificationPool.get(channelName);
    this.notificationPool.delete(channelName);
    this.stopConnectionHealthCheck(channelName);
    this.clearNotificationRestoreState(channelName);
    if (!connection) {
      this.logger.warn(`No active subscription for channel: ${channelName}`);
      return;
    }
    try {
      const isConnectionAlive =
        await this.oracleConnection.isSingleConnectionHealthy(connection, 500);
      if (isConnectionAlive) await connection.unsubscribe(channelName);
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
   * Registers an Oracle Continuous Query Notification subscription.
   *
   * Oracle uses the provided SQL query as the CQN subscription query and
   * generates an internal UUID subscription name. When Oracle reports changed
   * ROWIDs, the notifier fetches the changed rows and passes them to the
   * callback.
   *
   * @param {string} sqlCommand - SQL query to subscribe to.
   * @param {(args: TNotifyCallbackGeneric<T>) => Promise<void> | void} notifyCallback - Callback called with changed rows.
   * @param {IOracleOptionsNotify} options - CQN options that override default notification settings.
   * @returns {Promise<string>} - Name of the created subscription.
   * @throws {Error} - If subscription registration fails.
   */
  public override async listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: IOracleOptionsNotify = {}
  ): Promise<string> {
    if (Array.isArray(options.operations)) {
      if (options.operations.length >= 4)
        throw new ServerError(
          'Operations length must be less than 4, use opcode for all operations:  oracledb.CQN_OPCODE_ALL_OPS,'
        );
      const subscriptions: Array<string> = [];
      try {
        for (const operation of options.operations) {
          const channelName = randomUUID();
          const connection =
            await this.oracleConnection.createSingleConnection();
          const modifyOptions: TOracleNormilizeOptionsNotify = {
            ...options,
            operations: operation,
          };
          const subscription = await this.subscribe(
            connection,
            channelName,
            this.generateOptions(
              notifyCallback,
              modifyOptions,
              sqlCommand,
              channelName,
              connection
            ),
            sqlCommand,
            notifyCallback,
            modifyOptions
          );
          subscriptions.push(subscription);
        }
      } catch (error) {
        await Promise.allSettled(
          subscriptions.map((subscription) => this.unlistenNotify(subscription))
        );
        throw error;
      }
      return subscriptions.join(', ');
    } else {
      const channelName = randomUUID();
      const connection = await this.oracleConnection.createSingleConnection();
      const modifyOptions = options as TOracleNormilizeOptionsNotify;
      return this.subscribe(
        connection,
        channelName,
        this.generateOptions<T>(
          notifyCallback,
          modifyOptions,
          sqlCommand,
          channelName,
          connection
        ),
        sqlCommand,
        notifyCallback,
        modifyOptions
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
    const restoreOptions: TOracleNormilizeOptionsNotify = {
      operations: settings.operations,
      qos: settings.qos,
      timeout: settings.timeout,
      clientInitiated: settings.clientInitiated,
      maxRetries: settings.maxRetries,
      retryDelayMs: settings.retryDelayMs,
      retryAfterMaxDelayMs: settings.retryAfterMaxDelayMs,
    };
    const clientInitiated =
      settings.clientInitiated ??
      this.notifySettings.isNeedClientNotificationInit ??
      false;
    const subscribeOptions = {
      sql,
      clientInitiated,
      timeout: settings.timeout ?? 60 * 60 * 12,
      operations: settings.operations ?? oracledb.CQN_OPCODE_ALL_OPS,
      qos: settings.qos ?? oracledb.SUBSCR_QOS_ROWIDS,
      port:
        clientInitiated === true ? undefined : this.notifySettings.notifyPort, // Listener port for CQN
      callback: (msg: oracledb.SubscriptionMessage): Promise<void> =>
        this.makeSubscriptionHandler(
          notifyCallback,
          connection,
          channelName,
          subscribeOptions,
          restoreOptions,
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
  private async subscribe<T>(
    connection: oracledb.Connection,
    channelName: string,
    subscribeOptions: oracledb.SubscribeOptions,
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: TOracleNormilizeOptionsNotify
  ): Promise<string> {
    try {
      await connection.subscribe(channelName, subscribeOptions);
      this.notificationPool.set(channelName, connection);
      this.markNotificationActive(channelName);
      this.startConnectionHealthCheck({
        channelName,
        connection,
        intervalMs: this.CONNECTION_HEALTH_CHECK_INTERVAL_MS,
        isHealthy: (connection) =>
          this.oracleConnection.isSingleConnectionHealthy(connection),
        restore: () =>
          this.restoreSubscriptionCallback<T>(
            sqlCommand,
            channelName,
            notifyCallback,
            options
          ),
      });
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
    restoreOptions: TOracleNormilizeOptionsNotify,
    msg: IOracleNotifyMsg
  ): Promise<void> {
    try {
      if (
        (msg.type === oracledb.SUBSCR_EVENT_TYPE_DEREG ||
          msg.type === oracledb.SUBSCR_EVENT_TYPE_SHUTDOWN_ANY ||
          msg.type === oracledb.SUBSCR_EVENT_TYPE_SHUTDOWN) &&
        !msg.registered
      ) {
        if (this.notificationPool.get(channelName) !== client) return;
        return void this.restoreSubscriptionCallback<T>(
          subscribeUnionOptions.sql,
          channelName,
          notifyCallback,
          restoreOptions
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
        const tableName = SqlIdentifier.validateQualifiedIdentifier(
          name,
          'oracle notification table'
        );
        const tableEntry = affectedTables.get(tableName) ?? new Array<string>();
        rows?.forEach(({ rowid }) =>
          tableEntry.push(`'${SqlIdentifier.validateRowId(rowid)}'`)
        );
        affectedTables.set(tableName, tableEntry);
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

  private async restoreSubscription<T>(
    settings: IOracleNotifyRestoreSettings<T>,
    channelName: string
  ): Promise<void> {
    const connection = await this.oracleConnection.createSingleConnection();
    try {
      try {
        await this.unlistenNotify(channelName);
      } catch {
        const newChannelName = randomUUID();
        this.logger.warn(
          `Channel name for subscription ${channelName} change to ${newChannelName}`
        );
        channelName = newChannelName;
      }
      await this.subscribe(
        connection,
        channelName,
        this.generateOptions<T>(
          settings.notifyCallback,
          settings.options,
          settings.sqlCommand,
          channelName,
          connection
        ),
        settings.sqlCommand,
        settings.notifyCallback,
        settings.options
      );
    } catch (error: unknown) {
      this.stopConnectionHealthCheck(channelName);
      await this.oracleConnection.closeSingleConnection(connection);
      this.clearNotificationRestoreState(channelName);
      throw error;
    }
    this.logger.log(
      `Successfully restored subscription for sqlCommand: ${settings.sqlCommand}`
    );
    return;
  }

  private async restoreSubscriptionCallback<T>(
    sqlCommand: string,
    channelName: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: TOracleNormilizeOptionsNotify,
    maxRetries = options.maxRetries ?? this.RESTORE_MAX_RETRIES,
    retryDelayMs = options.retryDelayMs ?? this.RESTORE_RETRY_DELAY_MS,
    currentRetry = this.RESTORE_CURRENT_RETRY
  ): Promise<void> {
    await this.restoreNotification<IOracleNotifyRestoreSettings<T>>({
      channelName,
      settings: {
        sqlCommand,
        notifyCallback,
        options,
      },
      maxRetries,
      retryDelayMs,
      currentRetry,
      retryAfterMaxDelayMs:
        options.retryAfterMaxDelayMs ?? this.RESTORE_RETRY_AFTER_MAX_DELAY_MS,
      restore: (settings) => this.restoreSubscription(settings, channelName),
    });
  }
}
