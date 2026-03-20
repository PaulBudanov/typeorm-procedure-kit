import type { TConnectionTypes } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';

export abstract class DatabaseNotify<T extends TConnectionTypes> {
  protected notificationPool = new Map<string, T>();
  protected constructor(protected readonly logger: ILoggerModule) {}

  /**
   * Returns the notification pool for external management
   * @returns {Map<string, T>} - the notification pool map
   */
  public getNotificationPool(): Map<string, T> {
    return this.notificationPool;
  }

  /**
   * Gracefully shuts down all notification subscriptions
   * Unsubscribes from all channels and closes all connections
   * @returns {Promise<void>} - resolves when all cleanup is completed
   */
  public async destroy(): Promise<void> {
    if (this.notificationPool.size === 0) {
      // this.logger.log('No active notifications to cleanup');
      return;
    }

    const unsubscribePromises = Array.from(this.notificationPool.entries()).map(
      async ([channel]) => {
        try {
          await this.unlistenNotify(channel);
          this.logger.log(`Unsubscribed from channel: ${channel}`);
        } catch (error) {
          this.logger.error(
            `Error unsubscribing from channel ${channel}: ${
              (error as Error).message
            }`
          );
        }
      }
    );
    this.notificationPool.clear();
    await Promise.allSettled(unsubscribePromises);
    this.logger.log('DatabaseNotify shutdown completed');
  }

  public abstract unlistenNotify(channel: string): Promise<void>;

  public abstract listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: IOracleOptionsNotify
  ): Promise<string>;
}
