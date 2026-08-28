import { randomUUID } from 'crypto';

import oracledb from 'oracledb';

import { DatabaseErrorHandler } from '../../utils/database-error-handler.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../utils/resource-limits.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { DatabaseNotify } from '../abstract/database-notify.js';

import { OracleSqlCommand } from './oracle-sql.js';

import type { OracleConnection } from './oracle-connection.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  IOracleNotifyMsg,
  IOracleNotifyRestoreSettings,
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
  TOracleNormilizeOptionsNotify,
} from '../../types/notification.types.js';

interface IOracleCqnRefetchPlan {
  projection: string;
  tableName: string;
  alias?: string;
  predicate?: string;
}

export class OracleNotify extends DatabaseNotify<
  oracledb.Connection,
  IOracleOptionsNotify
> {
  private static readonly MAX_ROWIDS_PER_QUERY = 1_000;
  private readonly subscriptionQueues = new Map<
    string,
    { tail: Promise<void>; size: number }
  >();
  private readonly closingSubscriptionChannels = new Set<string>();
  /**
   * Creates an Oracle notification adapter for Continuous Query Notification.
   * @param oracleConnection - single-connection helper used by CQN subscriptions.
   * @param logger - logger used by notification operations.
   */
  public constructor(
    private readonly oracleConnection: OracleConnection,
    protected override readonly logger: ILoggerModule,
    private readonly maxNotificationQueue = DEFAULT_RESOURCE_LIMITS.maxNotificationQueue,
    private readonly maxNotificationRows = DEFAULT_RESOURCE_LIMITS.maxNotificationRows
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
    const channelNames = Array.from(
      new Set(
        channelName
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
    await Promise.all(
      channelNames.map((name) => this.closeSubscription(name, true))
    );
  }

  private async closeSubscription(
    channelName: string,
    shouldCancelRestore: boolean,
    shouldDrainCallbacks = true
  ): Promise<void> {
    if (shouldCancelRestore) this.cancelNotificationRestore(channelName);
    this.stopConnectionHealthCheck(channelName);
    if (!shouldDrainCallbacks) {
      await this.performCloseSubscription(channelName, shouldCancelRestore);
      return;
    }
    return this.closeNotificationChannel(channelName, () =>
      this.performCloseSubscription(channelName, shouldCancelRestore)
    );
  }

  private async performCloseSubscription(
    channelName: string,
    shouldCancelRestore: boolean
  ): Promise<void> {
    const connection = this.notificationPool.get(channelName);
    this.notificationPool.delete(channelName);
    if (shouldCancelRestore) this.clearNotificationRestoreState(channelName);
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

  protected override beginNotificationQueueClose(
    channelName: string
  ): Promise<void> | undefined {
    this.closingSubscriptionChannels.add(channelName);
    return this.subscriptionQueues.get(channelName)?.tail;
  }

  protected override completeNotificationQueueClose(channelName: string): void {
    this.subscriptionQueues.delete(channelName);
    this.closingSubscriptionChannels.delete(channelName);
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
    this.parseCqnRefetchPlan(sqlCommand);
    if (Array.isArray(options.operations)) {
      if (options.operations.length === 0) {
        throw new TypeError(
          'Oracle notification operations must contain at least one operation'
        );
      }
      if (options.operations.length >= 4)
        throw new ServerError(
          'Operations length must be less than 4, use opcode for all operations:  oracledb.CQN_OPCODE_ALL_OPS,'
        );
    }
    return this.trackNotificationRegistration(() =>
      this.registerSubscriptions(sqlCommand, notifyCallback, options)
    );
  }

  private async registerSubscriptions<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: IOracleOptionsNotify
  ): Promise<string> {
    if (Array.isArray(options.operations)) {
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
    this.parseCqnRefetchPlan(sql);
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
    const isClientInitiated =
      settings.clientInitiated === undefined ? true : settings.clientInitiated;
    const subscribeOptions = {
      sql,
      clientInitiated: isClientInitiated,
      timeout: settings.timeout ?? 60 * 60 * 12,
      operations: settings.operations ?? oracledb.CQN_OPCODE_ALL_OPS,
      qos: settings.qos ?? oracledb.SUBSCR_QOS_ROWIDS,
      port: isClientInitiated ? undefined : settings.cqnPort,
      callback: (msg: oracledb.SubscriptionMessage): Promise<void> =>
        this.enqueueSubscriptionMessage(
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

  private enqueueSubscriptionMessage<T>(
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    client: oracledb.Connection,
    channelName: string,
    subscribeUnionOptions: Omit<oracledb.SubscribeOptions, 'callback'>,
    restoreOptions: TOracleNormilizeOptionsNotify,
    msg: IOracleNotifyMsg
  ): Promise<void> {
    if (this.closingSubscriptionChannels.has(channelName)) {
      return Promise.resolve();
    }
    const queue = this.subscriptionQueues.get(channelName) ?? {
      tail: Promise.resolve(),
      size: 0,
    };
    if (queue.size >= this.maxNotificationQueue) {
      this.logger.error(
        `Oracle notification queue limit (${this.maxNotificationQueue}) exceeded for channel ${channelName}; dropping event`
      );
      return Promise.resolve();
    }
    queue.size += 1;
    const processMessage = (): Promise<void> => {
      if (this.notificationPool.get(channelName) !== client) {
        return Promise.resolve();
      }
      return this.makeSubscriptionHandler(
        notifyCallback,
        client,
        channelName,
        subscribeUnionOptions,
        restoreOptions,
        msg
      );
    };
    const current = queue.tail.then(processMessage, processMessage);
    queue.tail = current;
    this.subscriptionQueues.set(channelName, queue);
    return current.finally(() => {
      queue.size -= 1;
      if (queue.size === 0 && queue.tail === current) {
        this.subscriptionQueues.delete(channelName);
      }
    });
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
        intervalMs: OracleNotify.CONNECTION_HEALTH_CHECK_INTERVAL_MS,
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
        await this.restoreSubscriptionCallback<T>(
          subscribeUnionOptions.sql,
          channelName,
          notifyCallback,
          restoreOptions
        );
        return;
      }
      const tables = [
        ...(msg.tables ?? []),
        ...(msg.queries?.flatMap((query) => query.tables ?? []) ?? []),
      ];
      if (tables.length < 1) {
        this.logger.warn('No tables found in subscription message');
        return;
      }
      const refetchPlan = this.parseCqnRefetchPlan(subscribeUnionOptions.sql);
      const affectedTables = new Map<string, Set<string>>();
      let distinctRowIds = 0;
      for (const table of tables) {
        const { name, rows } = table;
        const tableName = SqlIdentifier.validateQualifiedIdentifier(
          name,
          'oracle notification table'
        );
        if (!this.isSameCqnTable(refetchPlan.tableName, tableName)) {
          this.logger.warn(
            `Ignoring Oracle CQN table ${tableName} because the subscription targets ${refetchPlan.tableName}`
          );
          continue;
        }
        if (!rows || rows.length === 0) {
          if (!affectedTables.has(tableName)) {
            affectedTables.set(tableName, new Set<string>());
          }
          continue;
        }

        const tableEntry = affectedTables.get(tableName) ?? new Set<string>();
        for (const { rowid } of rows) {
          const validatedRowId = SqlIdentifier.validateRowId(rowid);
          const previousSize = tableEntry.size;
          tableEntry.add(validatedRowId);
          if (tableEntry.size > previousSize) {
            distinctRowIds += 1;
            if (distinctRowIds > this.maxNotificationRows) {
              this.logger.error(
                `Oracle CQN event exceeds resourceLimits.maxNotificationRows (${this.maxNotificationRows}); dropping event`
              );
              return;
            }
          }
        }
        affectedTables.set(tableName, tableEntry);
      }
      for (const [tableName, rowIds] of affectedTables) {
        if (rowIds.size === 0) {
          this.logger.warn(
            `Oracle CQN event for ${tableName} did not include ROWIDs; skipping unsafe full-table refresh`
          );
          continue;
        }
        const rowIdList = Array.from(rowIds);
        for (
          let offset = 0;
          offset < rowIdList.length;
          offset += OracleNotify.MAX_ROWIDS_PER_QUERY
        ) {
          const chunk = rowIdList.slice(
            offset,
            offset + OracleNotify.MAX_ROWIDS_PER_QUERY
          );
          const bindings = Object.fromEntries(
            chunk.map((rowId, index) => [`rowid_${index}`, rowId])
          );
          const placeholders = Object.keys(bindings)
            .map((name) => `:${name}`)
            .join(', ');
          const sqlQuery = this.buildCqnRefetchSql(refetchPlan, placeholders);
          const result = await client.execute<T>(sqlQuery, bindings, {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            maxRows: chunk.length + 1,
          });
          const changedRows = (result.rows ?? []) as TNotifyCallbackGeneric<T>;
          if (Array.isArray(changedRows) && changedRows.length > chunk.length) {
            throw new ServerError(
              'Oracle CQN refetch returned more rows than the changed ROWID set'
            );
          }
          try {
            DatabaseErrorHandler.checkForDatabaseError<T>(changedRows);
            await notifyCallback(changedRows);
          } catch (error) {
            this.logger.error(
              `Unhandled callback error: ${(error as Error).message}`,
              (error as Error).stack
            );
            throw error;
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Subscription error: ${(error as Error).message}`,
        (error as Error).stack
      );
      return;
    }
  }

  private parseCqnRefetchPlan(sql: string): IOracleCqnRefetchPlan {
    const normalizedSql = sql.trim();
    if (normalizedSql.length === 0 || /;|--|\/\*|\*\//.test(normalizedSql)) {
      throw new ServerError(
        'Oracle CQN SQL must be one simple SELECT statement without comments or terminators'
      );
    }
    const match =
      /^SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_$#]*(?:\.[A-Za-z_][A-Za-z0-9_$#]*)?)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_$#]*))?(?:\s+WHERE\s+([\s\S]+?))?$/i.exec(
        normalizedSql
      );
    if (!match) {
      throw new ServerError(
        'Oracle CQN SQL must be a simple single-table SELECT with an optional alias and WHERE clause'
      );
    }
    const projection = match[1]?.trim() ?? '';
    const tableName = SqlIdentifier.validateQualifiedIdentifier(
      match[2] ?? '',
      'oracle CQN source table'
    );
    const alias = match[3]
      ? SqlIdentifier.validateIdentifier(match[3], 'oracle CQN table alias')
      : undefined;
    const predicate = match[4]?.trim();
    const forbiddenSql =
      /\b(?:SELECT|DISTINCT|JOIN|UNION|INTERSECT|MINUS|GROUP\s+BY|ORDER\s+BY|HAVING|FETCH|OFFSET|CONNECT\s+BY|START\s+WITH|MODEL)\b/i;
    if (
      projection.length === 0 ||
      forbiddenSql.test(projection) ||
      (predicate && forbiddenSql.test(predicate))
    ) {
      throw new ServerError(
        'Oracle CQN SQL uses a construct that cannot be safely refetched by ROWID'
      );
    }
    return { projection, tableName, alias, predicate };
  }

  private isSameCqnTable(
    configuredTable: string,
    changedTable: string
  ): boolean {
    const configuredParts = configuredTable.toUpperCase().split('.');
    const changedParts = changedTable.toUpperCase().split('.');
    if (configuredParts.at(-1) !== changedParts.at(-1)) return false;
    return (
      configuredParts.length === 1 ||
      changedParts.length === 1 ||
      configuredTable.toUpperCase() === changedTable.toUpperCase()
    );
  }

  private buildCqnRefetchSql(
    plan: IOracleCqnRefetchPlan,
    rowIdPlaceholders: string
  ): string {
    const fromSql = plan.alias
      ? `${plan.tableName} ${plan.alias}`
      : plan.tableName;
    const rowIdColumn = plan.alias ? `${plan.alias}.ROWID` : 'ROWID';
    const rowIdPredicate = `${rowIdColumn} IN (${rowIdPlaceholders})`;
    const whereSql = plan.predicate
      ? `(${plan.predicate}) AND ${rowIdPredicate}`
      : rowIdPredicate;
    return `SELECT ${plan.projection} FROM ${fromSql} WHERE ${whereSql}`;
  }

  private async restoreSubscription<T>(
    settings: IOracleNotifyRestoreSettings<T>,
    channelName: string
  ): Promise<void> {
    let connection: oracledb.Connection | undefined;
    try {
      try {
        await this.closeSubscription(channelName, false, false);
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
        await this.closeSubscription(channelName, false, false);
        return;
      }
    } catch (error: unknown) {
      this.stopConnectionHealthCheck(channelName);
      if (connection)
        await this.oracleConnection.closeSingleConnection(connection);
      this.clearNotificationRestoreState(channelName);
      throw error;
    }
    this.logger.log(`Successfully restored subscription: ${channelName}`);
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
    maxRetries = options.maxRetries ?? OracleNotify.RESTORE_MAX_RETRIES,
    retryDelayMs = options.retryDelayMs ?? OracleNotify.RESTORE_RETRY_DELAY_MS,
    currentRetry = OracleNotify.RESTORE_CURRENT_RETRY
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
        options.retryAfterMaxDelayMs ??
        OracleNotify.RESTORE_RETRY_AFTER_MAX_DELAY_MS,
      restore: (settings) => this.restoreSubscription(settings, channelName),
    });
  }
}
