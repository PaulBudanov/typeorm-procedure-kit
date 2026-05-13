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
   * Gets the SQL command to fetch the packages that were updated in the database
   * @returns The SQL command to fetch the packages that were updated in the database
   */
  public getPackagesNotifySql(): string {
    if (this.listenEventName)
      return PostgreSqlCommand.generateNotifyUpdatePackage(
        this.listenEventName
      );
    return PostgreSqlCommand.SQL_GET_NOTIFY_UPDATE_PACKAGE;
  }

  //TODO: Make return object more informative
  /**
   * Registers a notification listener for a given channel
   * @param {string} sqlCommand - SQL command to listen to
   * @param {function} notifyCallback - callback function to call when a notification is received
   * @returns {Promise<string>} - promise that resolves with the name of the channel
   * @throws {Error} - if the SQL command does not contain LISTEN or if the listener for the channel is already registered
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
   * Unregisters a notification listener for a given channel
   * @param {string} channel - name of the channel to unregister
   * @returns {Promise<void>} - resolves when the listener is unregistered
   * @throws {Error} - if there is an error unregistering the listener
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
   * Attempts to restore a client connection for a given channel by unregistering
   * the channel and then registering it again. If the attempt fails, it
   * will retry after a certain delay up to a maximum number of retries.
   * If the maximum number of retries is reached, it will wait for 30 minutes
   * and then attempt to restore the connection again.
   * @param {string} channelName - name of the channel to restore
   * @param {(args: TNotifyCallbackGeneric<T>) => void} callback - callback
   * to be registered for the channel
   * @param {number} [maxRetries=5] - maximum number of retries
   * @param {number} [retryDelayMs=30000] - delay in milliseconds between retries
   * @param {number} [currentRetry=1] - current retry attempt
   * @returns {Promise<void>} - resolves when the connection is restored
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
    await this.unlistenNotify(channelName);
    if (!channelName.includes('LISTEN ')) channelName = `LISTEN ${channelName}`;
    await this.listenNotify(channelName, notifyCallback, options);
    this.logger.log(
      `Successfully restored listener for sqlCommand: ${channelName}`
    );
    return;
  }
}
