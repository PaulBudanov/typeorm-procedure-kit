import type { TConnectionTypes } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  INotifyHealthCheckOptions,
  INotifyRestoreOptions,
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';
import { ServerError } from '../../utils/server-error.js';

interface RestoreState {
  isCancelled: boolean;
  isHealthCheckInProgress: boolean;
  activeRestore?: Promise<void>;
  cancelRetryDelay?: () => void;
  healthCheckTimer?: NodeJS.Timeout;
}

export abstract class DatabaseNotify<
  T extends TConnectionTypes,
  TOptions extends INotifyRetryOptions = INotifyRetryOptions,
> {
  protected readonly CONNECTION_HEALTH_CHECK_INTERVAL_MS = 1000 * 15;
  protected readonly RESTORE_RETRY_DELAY_MS: number = 1000 * 30;
  protected readonly RESTORE_RETRY_AFTER_MAX_DELAY_MS: number = 1000 * 60 * 30;
  protected readonly RESTORE_MAX_RETRIES: number = 5;
  protected readonly RESTORE_CURRENT_RETRY: number = 1;
  protected readonly DESTROY_RESTORE_WAIT_TIMEOUT_MS: number = 1000 * 5;

  private readonly restoreStates = new Map<string, RestoreState>();
  private isDestroyed = false;
  private destroyPromise?: Promise<void>;
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
  public destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.isDestroyed = true;
    this.cancelRestoreRetryDelays();
    this.destroyPromise = this.destroyNotifications();
    return this.destroyPromise;
  }

  private async destroyNotifications(): Promise<void> {
    this.stopAllConnectionHealthChecks();
    const activeRestores = this.getActiveRestores();
    const channels = new Set([
      ...this.notificationPool.keys(),
      ...activeRestores.map(([channel]) => channel),
    ]);
    if (channels.size === 0) {
      this.logger.log('No active notifications to cleanup');
    }
    channels.forEach((channel) => this.cancelNotificationRestore(channel));

    await Promise.allSettled([
      ...this.unsubscribeChannels(this.notificationPool.keys()),
      ...activeRestores.map(([channel, restore]) =>
        this.waitForActiveRestore(channel, restore)
      ),
    ]);

    const remainingChannels = Array.from(this.notificationPool.keys());
    remainingChannels.forEach((channel) =>
      this.cancelNotificationRestore(channel)
    );
    await Promise.allSettled(this.unsubscribeChannels(remainingChannels));

    this.notificationPool.clear();
    this.restoreStates.clear();
    this.logger.log('DatabaseNotify shutdown completed');
  }

  private unsubscribeChannels(
    channels: Iterable<string>
  ): Array<Promise<void>> {
    return Array.from(channels, async (channel) => {
      try {
        await this.unlistenNotify(channel);
      } catch (error) {
        this.logger.error(
          `Error unsubscribing from channel ${channel}: ${
            (error as Error).message
          }`
        );
      }
    });
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
    if (this.isDestroyed) return;
    this.stopConnectionHealthCheck(options.channelName);
    const timer = setInterval(() => {
      void this.checkConnection(options);
    }, options.intervalMs ?? this.CONNECTION_HEALTH_CHECK_INTERVAL_MS);
    timer.unref();
    this.getOrCreateRestoreState(options.channelName).healthCheckTimer = timer;
  }

  /**
   * Stops the periodic health check for a channel.
   * @param channelName - channel or subscription name.
   */
  protected stopConnectionHealthCheck(channelName: string): void {
    const state = this.restoreStates.get(channelName);
    if (!state?.healthCheckTimer) return;
    clearInterval(state.healthCheckTimer);
    delete state.healthCheckTimer;
    this.deleteRestoreStateIfIdle(channelName, state);
  }

  /**
   * Marks a notification as active after a successful registration.
   * A registration that happens during restore keeps the restore state intact
   * until the restore wrapper finishes.
   * @param channelName - channel or subscription name.
   */
  protected markNotificationActive(channelName: string): void {
    if (this.isDestroyed) {
      this.cancelNotificationRestore(channelName);
      return;
    }
    const state = this.restoreStates.get(channelName);
    if (!state) return;
    if (state.activeRestore) return;
    state.isCancelled = false;
    this.deleteRestoreStateIfIdle(channelName, state);
  }

  protected assertCanRegisterNotification(): void {
    if (this.isDestroyed) {
      throw new ServerError('Database notification adapter is shutting down');
    }
  }

  /**
   * Prevents queued restore work from recreating a notification after manual
   * unlisten or destroy.
   * @param channelName - channel or subscription name.
   */
  protected cancelNotificationRestore(channelName: string): void {
    this.getOrCreateRestoreState(channelName).isCancelled = true;
    this.cancelRestoreRetryDelay(channelName);
  }

  protected isNotificationRestoreCancelled(channelName: string): boolean {
    return (
      this.isDestroyed ||
      this.restoreStates.get(channelName)?.isCancelled === true
    );
  }

  /**
   * Clears restore and health-check bookkeeping for a channel.
   * @param channelName - channel or subscription name.
   */
  protected clearNotificationRestoreState(channelName: string): void {
    const state = this.restoreStates.get(channelName);
    if (!state) return;
    state.isHealthCheckInProgress = false;
    if (!this.isDestroyed && !state.activeRestore) state.isCancelled = false;
    this.deleteRestoreStateIfIdle(channelName, state);
  }

  /**
   * Runs one restore workflow with duplicate-restore and cancellation guards.
   * Concrete adapters provide the restore callback and adapter-specific state.
   * @param options - restore callback, settings, and retry options.
   */
  protected restoreNotification<TSettings>(
    options: INotifyRestoreOptions<TSettings>
  ): Promise<void> {
    if (this.isNotificationRestoreCancelled(options.channelName))
      return Promise.resolve();
    const state = this.getOrCreateRestoreState(options.channelName);
    if (state.activeRestore) return state.activeRestore;
    const restorePromise = Promise.resolve()
      .then(() => this.restoreNotificationWithRetry(options))
      .finally(() => {
        if (state.activeRestore === restorePromise) {
          delete state.activeRestore;
          if (!this.isDestroyed) state.isCancelled = false;
          this.deleteRestoreStateIfIdle(options.channelName, state);
        }
      });
    state.activeRestore = restorePromise;
    return restorePromise;
  }

  private async checkConnection(
    options: INotifyHealthCheckOptions<T>
  ): Promise<void> {
    const { channelName, connection } = options;
    const state = this.restoreStates.get(channelName);
    if (
      this.isDestroyed ||
      this.notificationPool.get(channelName) !== connection ||
      state?.isHealthCheckInProgress === true
    )
      return;
    const activeState = this.getOrCreateRestoreState(channelName);
    activeState.isHealthCheckInProgress = true;
    try {
      const isHealthy = await options.isHealthy(connection);
      if (this.isDestroyed || isHealthy) return;
      if (this.notificationPool.get(channelName) !== connection) return;
      await options.restore();
    } finally {
      activeState.isHealthCheckInProgress = false;
      this.deleteRestoreStateIfIdle(channelName, activeState);
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
      if (this.isNotificationRestoreCancelled(options.channelName)) return;
      try {
        await options.restore(options.settings);
        if (this.isNotificationRestoreCancelled(options.channelName)) return;
        break;
      } catch (error: unknown) {
        if (this.isNotificationRestoreCancelled(options.channelName)) return;
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
          await this.waitForRestoreRetryDelay(
            options.channelName,
            retryAfterMaxDelayMs
          );
          if (this.isNotificationRestoreCancelled(options.channelName)) return;
          currentRetry = this.RESTORE_CURRENT_RETRY;
          continue;
        }
        this.logger.warn(
          `Retrying in ${retryDelayMs / 1000} seconds... (Attempt ${
            currentRetry + 1
          }/${maxRetries})`
        );
        await this.waitForRestoreRetryDelay(options.channelName, retryDelayMs);
        if (this.isNotificationRestoreCancelled(options.channelName)) return;
        currentRetry += 1;
      }
    }
    return;
  }

  private waitForRestoreRetryDelay(
    channelName: string,
    delayMs: number
  ): Promise<void> {
    if (this.isDestroyed) return Promise.resolve();
    const state = this.getOrCreateRestoreState(channelName);
    return new Promise((resolve) => {
      const complete = (): void => {
        clearTimeout(timer);
        if (state.cancelRetryDelay === complete) {
          delete state.cancelRetryDelay;
        }
        this.deleteRestoreStateIfIdle(channelName, state);
        resolve();
      };
      const timer = setTimeout(complete, delayMs);
      timer.unref();
      state.cancelRetryDelay = complete;
    });
  }

  private cancelRestoreRetryDelay(channelName: string): void {
    this.restoreStates.get(channelName)?.cancelRetryDelay?.();
  }

  private cancelRestoreRetryDelays(): void {
    this.restoreStates.forEach((state) => state.cancelRetryDelay?.());
  }

  private getActiveRestores(): Array<[string, Promise<void>]> {
    const activeRestores: Array<[string, Promise<void>]> = [];
    this.restoreStates.forEach((state, channelName) => {
      if (state.activeRestore)
        activeRestores.push([channelName, state.activeRestore]);
    });
    return activeRestores;
  }

  private waitForActiveRestore(
    channelName: string,
    restore: Promise<void>
  ): Promise<void> {
    return new Promise((resolve) => {
      let isSettled = false;
      const timer: NodeJS.Timeout = setTimeout(() => {
        this.logger.warn(
          `Timed out waiting ${this.DESTROY_RESTORE_WAIT_TIMEOUT_MS}ms for notification restore ${channelName} during shutdown; continuing cleanup`
        );
        complete();
      }, this.DESTROY_RESTORE_WAIT_TIMEOUT_MS);
      const complete = (): void => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        resolve();
      };
      timer.unref();
      void restore.then(complete, complete);
    });
  }

  private stopAllConnectionHealthChecks(): void {
    this.restoreStates.forEach((state, channelName) => {
      if (!state.healthCheckTimer) return;
      clearInterval(state.healthCheckTimer);
      delete state.healthCheckTimer;
      this.deleteRestoreStateIfIdle(channelName, state);
    });
  }

  private getOrCreateRestoreState(channelName: string): RestoreState {
    const existingState = this.restoreStates.get(channelName);
    if (existingState) return existingState;
    const state: RestoreState = {
      isCancelled: false,
      isHealthCheckInProgress: false,
    };
    this.restoreStates.set(channelName, state);
    return state;
  }

  private deleteRestoreStateIfIdle(
    channelName: string,
    state: RestoreState
  ): void {
    if (
      state.isCancelled ||
      state.isHealthCheckInProgress ||
      state.activeRestore ||
      state.cancelRetryDelay ||
      state.healthCheckTimer
    )
      return;
    this.restoreStates.delete(channelName);
  }
}
