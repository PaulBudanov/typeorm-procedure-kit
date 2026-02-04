import type { TConnectionTypes } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';

export abstract class DatabaseNotify<T extends TConnectionTypes> {
  protected notificationPool = new Map<string, T>();
  protected constructor(protected readonly logger: ILoggerModule) {
    process.on('beforeExit', () => void this.handleApplicationExit());
  }
  /**
   * Handle application exit by unsubscribing from all registered channels
   * and then closing the corresponding client connections
   * @returns {Promise<void>} - resolves when all channels are unsubscribed
   * and the client connections are closed
   */
  private async handleApplicationExit(): Promise<void> {
    if (this.notificationPool.size === 0) return;
    for (const [channel] of this.notificationPool.entries())
      try {
        await this.unlistenNotify(channel);
        this.logger.log(
          `Unsubscribed and closed connection for channel: ${channel}`
        );
      } catch (err) {
        this.logger.error(
          `Error unsubscribing/closing channel ${channel}: ${
            (err as Error).message
          }`
        );
      }
  }
  public abstract unlistenNotify(channel: string): Promise<void>;

  public abstract listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: IOracleOptionsNotify
  ): Promise<string>;
}
