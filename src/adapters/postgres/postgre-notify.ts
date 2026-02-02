import { type PoolClient } from 'pg';

import type { ILoggerModule } from '../../types/logger.types.js';
import type { TNotifyCallbackGeneric } from '../../types/notification.types.js';
import { AsyncUtils } from '../../utils/async-utils.js';
import { DatabaseErrorHandler } from '../../utils/database-error-handler.js';
import { ServerError } from '../../utils/server-error.js';
import { DatabaseNotify } from '../abstract/database-notify.js';

import type { PostgreConnection } from './postgre-connection.js';
import { PostgreSqlCommand } from './postgre-sql.js';
export class PostgreNotify extends DatabaseNotify<PoolClient> {
  public constructor(
    private readonly postgreConnection: PostgreConnection,
    protected readonly logger: ILoggerModule
  ) {
    super(logger);
  }

  /**
   * Gets the SQL command to fetch the packages that were updated in the database
   * @returns The SQL command to fetch the packages that were updated in the database
   */
  public getPackagesNotifySql(): string {
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
  public async listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>
  ): Promise<string> {
    try {
      const channelName = sqlCommand.replace('LISTEN ', '');
      if (!sqlCommand.includes('LISTEN'))
        throw new ServerError(
          'SQL command must contain LISTEN for notification, example: LISTEN'
        );
      if (this.notificationPool.has(channelName)) {
        this.logger.warn(
          `Listener for channel "${channelName}" already registered`
        );
        throw new ServerError(
          `Listener for channel "${channelName}" already registered`
        );
      }
      const client =
        await this.postgreConnection.getConnectionFromPool('master');
      await client.query(sqlCommand);
      this.postgreConnection.registerConnectionErrorHandler(
        client,
        () =>
          void this.restoreClientConnectionCallback<T>(
            channelName,
            notifyCallback
          )
      );
      client.on('notification', (msg) => {
        // console.log(msg.channel, channelName);
        if (msg.channel?.toLowerCase() === channelName.toLowerCase()) {
          let payload: TNotifyCallbackGeneric<T>;
          try {
            payload = (
              msg.payload ? (JSON.parse(msg.payload) as T) : {}
            ) as TNotifyCallbackGeneric<T>;
          } catch {
            this.logger.error(
              `Error parsing JSON payload in notification from channel ${channelName} : ${msg.payload} , returning as is.`
            );
            payload = msg.payload as TNotifyCallbackGeneric<T>;
          }
          DatabaseErrorHandler.checkForDatabaseError(payload);
          void notifyCallback(payload);
        }
        return;
      });
      this.notificationPool.set(channelName, client);
      this.logger.log(
        `Successfully registered listener for channel: ${channelName}`
      );
      return channelName;
    } catch (error: unknown) {
      this.logger.error(
        `Error registering notification listener: ${(error as Error).message}`,
        (error as Error).stack
      );
      throw error;
    }
  }

  /**
   * Unregisters a notification listener for a given channel
   * @param {string} channel - name of the channel to unregister
   * @returns {Promise<void>} - resolves when the listener is unregistered
   * @throws {Error} - if there is an error unregistering the listener
   */
  public async unlistenNotify(channel: string): Promise<void> {
    const client = this.notificationPool.get(channel);
    this.notificationPool.delete(channel);
    try {
      if (!client) {
        this.logger.warn(`No listener found for channel: ${channel}`);
        return;
      }
      await client.query(`UNLISTEN ${channel}`);
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
      if (client)
        await this.postgreConnection.releaseConnectionFromPool(client);
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
    maxRetries = 5,
    retryDelayMs = 30000,
    currentRetry = 1
  ): Promise<void> {
    try {
      await this.unlistenNotify(channelName);
      if (!channelName.includes('LISTEN ')) {
        const sqlCommand = `LISTEN ${channelName}`;
        await this.listenNotify(sqlCommand, notifyCallback);
        return;
      }
      await this.listenNotify(channelName, notifyCallback);
      this.logger.log(
        `Successfully restored listener for channel: ${channelName}`
      );
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Attempt ${currentRetry} failed to restore notification listener for channel "${channelName}": ${
          (error as Error).message
        }`,
        (error as Error).stack
      );

      if (currentRetry >= maxRetries) {
        this.logger.error(
          `Max retries (${maxRetries}) reached for restoring listener on channel: ${channelName}. Giving up.`
        );
        this.logger.warn('Restarting client connection after 30 min');
        await AsyncUtils.delay(1000 * 60 * 30);
        await this.restoreClientConnectionCallback(channelName, notifyCallback);
        return;
      }
      this.logger.warn(
        `Retrying in ${
          retryDelayMs / 1000
        } seconds... (Attempt ${currentRetry}/${maxRetries})`
      );
      await AsyncUtils.delay(retryDelayMs);
      await this.restoreClientConnectionCallback(
        channelName,
        notifyCallback,
        maxRetries,
        retryDelayMs,
        currentRetry + 1
      );
    }
  }
}
