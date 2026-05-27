import type { Client } from 'pg';

import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  INotifyRetryOptions,
  IPostgreNotifyRestoreSettings,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';
import { DatabaseErrorHandler } from '../../utils/database-error-handler.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { DatabaseNotify } from '../abstract/database-notify.js';

import type { PostgreConnection } from './postgre-connection.js';
import { PostgreSqlCommand } from './postgre-sql.js';
export class PostgreNotify extends DatabaseNotify<Client> {
  public constructor(
    private readonly postgreConnection: PostgreConnection,
    protected readonly logger: ILoggerModule,
    private readonly listenEventName?: string
  ) {
    super(logger);
  }

  /**
   * Gets the LISTEN command used to receive package metadata update events.
   * @returns configured package update LISTEN command.
   */
  public getPackagesNotifySql(): string {
    if (this.listenEventName)
      return PostgreSqlCommand.generateNotifyUpdatePackage(
        this.listenEventName
      );
    return PostgreSqlCommand.SQL_GET_NOTIFY_UPDATE_PACKAGE;
  }

  /**
   * Registers a PostgreSQL LISTEN subscription on a dedicated client.
   * The channel is parsed from `LISTEN channel`, normalized with identifier
   * quoting, and stored under the raw channel name returned by this method.
   * Connection-loss handlers and periodic health checks restore the listener
   * with the same callback and retry options.
   * @param sqlCommand - LISTEN command, for example `LISTEN channel_name`.
   * @param notifyCallback - callback invoked with parsed JSON payload, raw payload, or an empty object.
   * @param options - restore retry options.
   * @returns registered channel name.
   * @throws ServerError when the SQL command is not a LISTEN command or the channel is already active.
   */
  public override async listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: INotifyRetryOptions = {}
  ): Promise<string> {
    let client: Client | undefined;
    try {
      const match = sqlCommand
        .trim()
        .match(/^LISTEN\s+"?([A-Za-z_][A-Za-z0-9_$#]*)"?\s*;?$/i);
      const parsedChannelName = match?.[1];
      if (!parsedChannelName)
        throw new ServerError(
          'SQL command must contain LISTEN for notification, example: LISTEN'
        );
      const listenSql = `LISTEN ${SqlIdentifier.quotePostgresIdentifier(
        parsedChannelName
      )}`;
      if (this.notificationPool.has(parsedChannelName)) {
        throw new ServerError(
          `Listener for channel "${parsedChannelName}" already registered`
        );
      }
      client = await this.postgreConnection.createSingleConnection();
      await client.query(listenSql);
      this.postgreConnection.registerConnectionErrorHandler(client, () => {
        if (this.notificationPool.get(parsedChannelName) !== client) return;
        void this.restoreClientConnectionCallback<T>(
          parsedChannelName,
          notifyCallback,
          options
        );
      });
      client.on('notification', (msg) => {
        if (msg.channel?.toLowerCase() === parsedChannelName.toLowerCase()) {
          void this.handleNotificationPayload<T>(
            parsedChannelName,
            msg.payload,
            notifyCallback
          );
        }
        return;
      });
      this.notificationPool.set(parsedChannelName, client);
      this.markNotificationActive(parsedChannelName);
      this.startConnectionHealthCheck({
        channelName: parsedChannelName,
        connection: client,
        intervalMs: this.CONNECTION_HEALTH_CHECK_INTERVAL_MS,
        isHealthy: (connection) =>
          this.postgreConnection.isSingleConnectionHealthy(connection),
        restore: () =>
          this.restoreClientConnectionCallback<T>(
            parsedChannelName,
            notifyCallback,
            options
          ),
      });
      this.logger.log(
        `Successfully registered listener for channel: ${parsedChannelName}`
      );
      return parsedChannelName;
    } catch (error: unknown) {
      this.logger.error(
        `Error registering notification listener: ${(error as Error).message}`,
        (error as Error).stack
      );
      if (client) await this.postgreConnection.closeSingleConnection(client);
      throw error;
    }
  }

  private async handleNotificationPayload<T>(
    channelName: string,
    rawPayload: string | undefined,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>
  ): Promise<void> {
    let payload: TNotifyCallbackGeneric<T>;
    try {
      payload = (
        rawPayload ? (JSON.parse(rawPayload) as T) : {}
      ) as TNotifyCallbackGeneric<T>;
    } catch {
      this.logger.error(
        `Error parsing JSON payload in notification from channel ${channelName} : ${rawPayload} , returning as is.`
      );
      payload = rawPayload as TNotifyCallbackGeneric<T>;
    }

    try {
      DatabaseErrorHandler.checkForDatabaseError(payload);
      await notifyCallback(payload);
    } catch (error) {
      this.logger.error(
        `Unhandled notification callback error for channel "${channelName}": ${
          (error as Error).message
        }`,
        (error as Error).stack
      );
    }
  }

  /**
   * Unregisters a PostgreSQL notification listener.
   * Restore attempts and health checks are stopped first. If the client is
   * still healthy, UNLISTEN is sent before closing the dedicated connection.
   * @param channel - registered channel name.
   */
  public override async unlistenNotify(channel: string): Promise<void> {
    this.cancelNotificationRestore(channel);
    await this.closeListenerConnection(channel);
    this.clearNotificationRestoreState(channel);
  }

  private async closeListenerConnection(channel: string): Promise<void> {
    const client = this.notificationPool.get(channel);
    this.notificationPool.delete(channel);
    this.stopConnectionHealthCheck(channel);
    try {
      if (!client) {
        this.logger.warn(`No listener found for channel: ${channel}`);
        return;
      }
      const isConnectionAlive =
        await this.postgreConnection.isSingleConnectionHealthy(client, 500);
      if (isConnectionAlive)
        await client.query(
          `UNLISTEN ${SqlIdentifier.quotePostgresIdentifier(channel)}`
        );
      this.logger.log(
        `Successfully unregistered listener for channel: ${channel}`
      );
    } catch (error: unknown) {
      this.logger.error(
        `Error unregistering notification listener: ${
          (error as Error).message
        }`,
        (error as Error).stack
      );
    } finally {
      if (client) await this.postgreConnection.closeSingleConnection(client);
    }
  }

  /**
   * Schedules a guarded restore for a PostgreSQL listener.
   * Duplicate restore attempts for the same channel are ignored. Retry timing
   * comes from options when provided, otherwise from DatabaseNotify defaults.
   * @param channelName - channel to restore.
   * @param notifyCallback - callback to reattach to the restored listener.
   * @param options - restore retry options.
   * @param maxRetries - maximum attempts before the long retry delay.
   * @param retryDelayMs - delay between regular retry attempts.
   * @param currentRetry - initial retry counter.
   */
  private async restoreClientConnectionCallback<T>(
    channelName: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: INotifyRetryOptions = {},
    maxRetries = options.maxRetries ?? this.RESTORE_MAX_RETRIES,
    retryDelayMs = options.retryDelayMs ?? this.RESTORE_RETRY_DELAY_MS,
    currentRetry = this.RESTORE_CURRENT_RETRY
  ): Promise<void> {
    await this.restoreNotification<IPostgreNotifyRestoreSettings<T>>({
      channelName,
      settings: {
        notifyCallback,
        options,
      },
      maxRetries,
      retryDelayMs,
      currentRetry,
      retryAfterMaxDelayMs:
        options.retryAfterMaxDelayMs ?? this.RESTORE_RETRY_AFTER_MAX_DELAY_MS,
      restore: (settings) =>
        this.restoreClientConnection(
          channelName,
          settings.notifyCallback,
          settings.options
        ),
    });
  }

  private async restoreClientConnection<T>(
    channelName: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: INotifyRetryOptions
  ): Promise<void> {
    await this.closeListenerConnection(channelName);
    if (this.isNotificationRestoreCancelled(channelName)) return;
    if (!channelName.includes('LISTEN ')) channelName = `LISTEN ${channelName}`;
    const restoredChannelName = await this.listenNotify(
      channelName,
      notifyCallback,
      options
    );
    if (this.isNotificationRestoreCancelled(restoredChannelName)) {
      await this.closeListenerConnection(restoredChannelName);
      return;
    }
    this.logger.log(
      `Successfully restored listener for sqlCommand: ${channelName}`
    );
    return;
  }
}
