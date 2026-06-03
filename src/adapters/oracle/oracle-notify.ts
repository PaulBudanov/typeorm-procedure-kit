import { randomUUID } from 'crypto';

import oracledb from 'oracledb';

import type { ILoggerModule } from '../../types/logger.types.js';
import type {
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

import type { OracleConnection } from './oracle-connection.js';
import { OracleSqlCommand } from './oracle-sql.js';

export class OracleNotify extends DatabaseNotify<
  oracledb.Connection,
  IOracleOptionsNotify
> {
  /**
   * Creates an Oracle notification adapter for Continuous Query Notification.
   * @param oracleConnection - single-connection helper used by CQN subscriptions.
   * @param logger - logger used by notification operations.
   */
  public constructor(
    private readonly oracleConnection: OracleConnection,
    protected readonly logger: ILoggerModule
  ) {
    super(logger);
  }
  /**
   * Builds the CQN query used to watch package metadata changes.
   * @param packages - package names to include in the notification query.
   * @returns SQL query for package metadata update notifications.
   * @example
   * const notifySql = dataBase.getPackagesNotifySql(['PACKAGE_NAME_1', 'PACKAGE_NAME_2']);
   */
  public getPackagesNotifySql(packages: Array<string>): string {
    if (packages.length === 0) {
      throw new ServerError(
        'At least one package is required to build Oracle metadata notification SQL'
      );
    }
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
   * Unsubscribes one CQN subscription and closes its dedicated connection.
   * Restore attempts and health checks are stopped first. If the connection is
   * already unhealthy, Oracle unsubscribe is skipped and the connection is
   * closed directly.
   * @param channelName - subscription name returned by listenNotify.
   */
  public override async unlistenNotify(channelName: string): Promise<void> {
    await this.closeSubscription(channelName, true);
  }

  private async closeSubscription(
    channelName: string,
    cancelRestore: boolean
  ): Promise<void> {
    if (cancelRestore) this.cancelNotificationRestore(channelName);
    const connection = this.notificationPool.get(channelName);
    this.notificationPool.delete(channelName);
    this.stopConnectionHealthCheck(channelName);
    if (cancelRestore) this.clearNotificationRestoreState(channelName);
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
  /**
   * Registers an Oracle Continuous Query Notification subscription.
   *
   * Oracle uses the provided SQL query as the CQN subscription query and
   * generates an internal UUID subscription name. When Oracle reports changed
   * ROWIDs, the notifier fetches the changed rows and passes them to the
   * callback. When `operations` is an array, a separate subscription is
   * created for each operation and the returned value is a comma-separated
   * list of subscription names.
   *
   * @param sqlCommand - SQL query to subscribe to.
   * @param notifyCallback - callback invoked with changed rows.
   * @param options - CQN and restore retry options.
   * @returns created subscription name or comma-separated subscription names.
   * @throws ServerError when too many per-operation subscriptions are requested.
   * @throws Error when Oracle subscription registration fails.
   */
  public override async listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: IOracleOptionsNotify = {}
  ): Promise<string> {
    this.assertCanRegisterNotification();
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
      cqnPort: settings.cqnPort,
      maxRetries: settings.maxRetries,
      retryDelayMs: settings.retryDelayMs,
      retryAfterMaxDelayMs: settings.retryAfterMaxDelayMs,
    };
    const clientInitiated =
      settings.clientInitiated === undefined ? true : settings.clientInitiated;
    const subscribeOptions = {
      sql,
      clientInitiated,
      timeout: settings.timeout ?? 60 * 60 * 12,
      operations: settings.operations ?? oracledb.CQN_OPCODE_ALL_OPS,
      qos: settings.qos ?? oracledb.SUBSCR_QOS_ROWIDS,
      port: clientInitiated === true ? undefined : settings.cqnPort,
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
   * Registers one Oracle CQN subscription on an existing connection.
   * The connection is stored in the notification pool only after Oracle
   * confirms the subscription.
   * @param connection - dedicated Oracle connection.
   * @param channelName - generated subscription name.
   * @param subscribeOptions - Oracle subscription options.
   * @param sqlCommand - original subscription SQL used for restore.
   * @param notifyCallback - callback to reattach during restore.
   * @param options - normalized CQN and restore retry options.
   * @returns registered subscription name.
   * @throws Error when Oracle subscription registration fails.
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
      this.assertCanRegisterNotification();
      await connection.subscribe(channelName, subscribeOptions);
      this.assertCanRegisterNotification();
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
   * Deregistration or shutdown events trigger restore when the message belongs
   * to the current pooled connection. Change events are expanded by ROWID into
   * SELECT queries, and fetched rows are passed to the callback.
   * @param notifyCallback - callback invoked for changed rows.
   * @param client - Oracle connection that received the message.
   * @param channelName - subscription name.
   * @param subscribeUnionOptions - subscription options without the callback.
   * @param restoreOptions - normalized options reused by restore.
   * @param msg - Oracle subscription message.
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
    let connection: oracledb.Connection | undefined;
    try {
      try {
        await this.closeSubscription(channelName, false);
        if (this.isNotificationRestoreCancelled(channelName)) return;
      } catch {
        const newChannelName = randomUUID();
        this.logger.warn(
          `Channel name for subscription ${channelName} change to ${newChannelName}`
        );
        channelName = newChannelName;
      }
      if (this.isNotificationRestoreCancelled(channelName)) return;
      connection = await this.oracleConnection.createSingleConnection();
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
      if (this.isNotificationRestoreCancelled(channelName)) {
        await this.closeSubscription(channelName, false);
        return;
      }
    } catch (error: unknown) {
      this.stopConnectionHealthCheck(channelName);
      if (connection)
        await this.oracleConnection.closeSingleConnection(connection);
      this.clearNotificationRestoreState(channelName);
      throw error;
    }
    this.logger.log(
      `Successfully restored subscription for sqlCommand: ${settings.sqlCommand}`
    );
    return;
  }

  /**
   * Schedules a guarded restore for an Oracle CQN subscription.
   * Duplicate restore attempts for the same subscription are ignored. Retry
   * timing comes from options when provided, otherwise from DatabaseNotify
   * defaults.
   * @param sqlCommand - original CQN query to subscribe again.
   * @param channelName - subscription name to restore.
   * @param notifyCallback - callback to reattach to the subscription.
   * @param options - normalized CQN and restore retry options.
   * @param maxRetries - maximum attempts before the long retry delay.
   * @param retryDelayMs - delay between regular retry attempts.
   * @param currentRetry - initial retry counter.
   */
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
