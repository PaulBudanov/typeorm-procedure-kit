import type { TConnectionTypes } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  INotifyHealthCheckOptions,
  INotifyRestoreOptions,
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';
import { AsyncUtils } from '../../utils/async-utils.js';

export abstract class DatabaseNotify<
  T extends TConnectionTypes,
  TOptions extends INotifyRetryOptions = INotifyRetryOptions,
> {
  protected readonly CONNECTION_HEALTH_CHECK_INTERVAL_MS = 1000 * 15;
  protected readonly RESTORE_RETRY_DELAY_MS: number = 1000 * 30;
  protected readonly RESTORE_RETRY_AFTER_MAX_DELAY_MS: number = 1000 * 60 * 30;
  protected readonly RESTORE_MAX_RETRIES: number = 5;
  protected readonly RESTORE_CURRENT_RETRY: number = 1;

  private readonly healthCheckTimers = new Map<string, NodeJS.Timeout>();
  private readonly healthChecksInProgress = new Set<string>();
  private readonly restoringNotifications = new Set<string>();
  private readonly cancelledRestores = new Set<string>();
  protected readonly notificationPool = new Map<string, T>();
  protected constructor(protected readonly logger: ILoggerModule) {}

  /**
   * Returns the active notification pool for diagnostics and external cleanup.
   * Keys are adapter-specific channel or subscription names.
   */
  public getNotificationPool(): Map<string, T> {
    return this.notificationPool;
  }

  /**
   * Gracefully shuts down all notification subscriptions.
   * Active restore attempts are cancelled first, then all pooled connections
   * are unsubscribed and closed by the concrete adapter.
   */
  public async destroy(): Promise<void> {
    const channels = new Set([
      ...this.notificationPool.keys(),
      ...this.restoringNotifications,
    ]);
    if (channels.size === 0) {
      this.logger.log('No active notifications to cleanup');
      return;
    }
    channels.forEach((channel) => this.cancelNotificationRestore(channel));

    const unsubscribePromises = Array.from(this.notificationPool.entries()).map(
      async ([channel]) => {
        try {
          await this.unlistenNotify(channel);
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
    this.restoringNotifications.clear();
    this.healthChecksInProgress.clear();
    this.healthCheckTimers.forEach((timer) => clearTimeout(timer));
    await Promise.allSettled(unsubscribePromises);
    this.logger.log('DatabaseNotify shutdown completed');
  }

  /**
   * Unregisters one notification subscription and closes its single
   * notification connection.
   * @param channel - channel or subscription name returned by listenNotify.
   */
  public abstract unlistenNotify(channel: string): Promise<void>;

  /**
   * Registers one notification subscription.
   * @param sqlCommand - vendor-specific notification SQL.
   * @param notifyCallback - callback invoked with parsed notification payload.
   * @param options - vendor-specific notification and restore retry options.
   * @returns registered channel or subscription name.
   */
  public abstract listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: TOptions
  ): Promise<string>;

  /**
   * Starts a periodic health check for a notification connection.
   * Existing timers for the same channel are replaced. When the connection is
   * unhealthy and still belongs to the channel, the provided restore callback
   * is executed.
   * @param options - connection, health check, and restore settings.
   */
  protected startConnectionHealthCheck(
    options: INotifyHealthCheckOptions<T>
  ): void {
    this.stopConnectionHealthCheck(options.channelName);
    const timer = setInterval(() => {
      void this.checkConnection(options);
    }, options.intervalMs ?? this.CONNECTION_HEALTH_CHECK_INTERVAL_MS);
    timer.unref();
    this.healthCheckTimers.set(options.channelName, timer);
  }

  /**
   * Stops the periodic health check for a channel.
   * @param channelName - channel or subscription name.
   */
  protected stopConnectionHealthCheck(channelName: string): void {
    const timer = this.healthCheckTimers.get(channelName);
    if (!timer) return;
    clearInterval(timer);
    this.healthCheckTimers.delete(channelName);
  }

  /**
   * Marks a notification as active after a successful registration.
   * A registration that happens during restore keeps the restore state intact
   * until the restore wrapper finishes.
   * @param channelName - channel or subscription name.
   */
  protected markNotificationActive(channelName: string): void {
    if (this.restoringNotifications.has(channelName)) return;
    this.cancelledRestores.delete(channelName);
  }

  /**
   * Prevents queued restore work from recreating a notification after manual
   * unlisten or destroy.
   * @param channelName - channel or subscription name.
   */
  protected cancelNotificationRestore(channelName: string): void {
    this.cancelledRestores.add(channelName);
  }

  protected isNotificationRestoreCancelled(channelName: string): boolean {
    return this.cancelledRestores.has(channelName);
  }

  /**
   * Clears restore and health-check bookkeeping for a channel.
   * @param channelName - channel or subscription name.
   */
  protected clearNotificationRestoreState(channelName: string): void {
    if (this.restoringNotifications.has(channelName)) {
      this.healthChecksInProgress.delete(channelName);
      return;
    }
    this.cancelledRestores.delete(channelName);
    this.restoringNotifications.delete(channelName);
    this.healthChecksInProgress.delete(channelName);
  }

  /**
   * Runs one restore workflow with duplicate-restore and cancellation guards.
   * Concrete adapters provide the restore callback and adapter-specific state.
   * @param options - restore callback, settings, and retry options.
   */
  protected async restoreNotification<TSettings>(
    options: INotifyRestoreOptions<TSettings>
  ): Promise<void> {
    if (this.cancelledRestores.has(options.channelName)) return;
    if (this.restoringNotifications.has(options.channelName)) return;
    this.restoringNotifications.add(options.channelName);
    try {
      await this.restoreNotificationWithRetry(options);
    } finally {
      this.restoringNotifications.delete(options.channelName);
    }
  }

  private async checkConnection(
    options: INotifyHealthCheckOptions<T>
  ): Promise<void> {
    const { channelName, connection } = options;
    if (
      this.notificationPool.get(channelName) !== connection ||
      this.healthChecksInProgress.has(channelName)
    )
      return;
    this.healthChecksInProgress.add(channelName);
    try {
      const isHealthy = await options.isHealthy(connection);
      if (isHealthy) return;
      if (this.notificationPool.get(channelName) !== connection) return;
      await options.restore();
    } finally {
      this.healthChecksInProgress.delete(channelName);
    }
  }

  /**
   * Executes restore attempts in a loop. After maxRetries are exhausted, waits
   * for retryAfterMaxDelayMs and starts the attempt counter again.
   * @param options - restore callback, settings, and retry timing.
   */
  private async restoreNotificationWithRetry<TSettings>(
    options: INotifyRestoreOptions<TSettings>
  ): Promise<void> {
    const maxRetries = options.maxRetries ?? this.RESTORE_MAX_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? this.RESTORE_RETRY_DELAY_MS;
    const retryAfterMaxDelayMs =
      options.retryAfterMaxDelayMs ?? this.RESTORE_RETRY_AFTER_MAX_DELAY_MS;
    let currentRetry = options.currentRetry ?? this.RESTORE_CURRENT_RETRY;

    while (currentRetry <= maxRetries) {
      if (this.cancelledRestores.has(options.channelName)) return;
      try {
        await options.restore(options.settings);
        if (this.cancelledRestores.has(options.channelName)) return;
        break;
      } catch (error: unknown) {
        if (this.cancelledRestores.has(options.channelName)) return;
        this.logger.error(
          `Attempt ${currentRetry}/${maxRetries} failed to restore ${
            options.channelName
          }: ${(error as Error).message}`,
          (error as Error).stack
        );
        if (currentRetry >= maxRetries) {
          this.logger.error(
            `Max retry attempts (${maxRetries}) exceeded for ${
              options.channelName
            }. Scheduling recovery in ${retryAfterMaxDelayMs / 1000} seconds.`
          );
          await AsyncUtils.delay(retryAfterMaxDelayMs);
          if (this.cancelledRestores.has(options.channelName)) return;
          currentRetry = this.RESTORE_CURRENT_RETRY;
          continue;
        }
        this.logger.warn(
          `Retrying in ${retryDelayMs / 1000} seconds... (Attempt ${
            currentRetry + 1
          }/${maxRetries})`
        );
        await AsyncUtils.delay(retryDelayMs);
        if (this.cancelledRestores.has(options.channelName)) return;
        currentRetry += 1;
      }
    }
    return;
  }
}
