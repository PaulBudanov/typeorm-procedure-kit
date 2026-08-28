import { ServerError } from '../../utils/server-error.js';

import type { TConnectionTypes } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  INotifyHealthCheckOptions,
  INotifyRestoreOptions,
  INotifyRetryOptions,
  IRestoreState,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';

export abstract class DatabaseNotify<
  T extends TConnectionTypes,
  TOptions extends INotifyRetryOptions = INotifyRetryOptions,
> {
  protected static readonly CONNECTION_HEALTH_CHECK_INTERVAL_MS = 1000 * 15;
  protected static readonly RESTORE_RETRY_DELAY_MS: number = 1000 * 30;
  protected static readonly RESTORE_RETRY_AFTER_MAX_DELAY_MS: number =
    1000 * 60 * 30;
  protected static readonly RESTORE_MAX_RETRIES: number = 5;
  protected static readonly RESTORE_CURRENT_RETRY: number = 1;
  protected static readonly DESTROY_RESTORE_WAIT_TIMEOUT_MS: number = 1000 * 5;

  private readonly restoreStates = new Map<string, IRestoreState>();
  private readonly notificationClosePromises = new Map<string, Promise<void>>();
  private readonly pendingNotificationRegistrations = new Set<
    Promise<unknown>
  >();
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
    const pendingRegistrations = Array.from(
      this.pendingNotificationRegistrations
    );
    const channels = new Set([
      ...this.notificationPool.keys(),
      ...activeRestores.map(([channel]) => channel),
    ]);
    if (channels.size === 0 && pendingRegistrations.length === 0) {
      this.logger.log('No active notifications to cleanup');
    }
    channels.forEach((channel) => {
      this.cancelNotificationRestore(channel);
    });

    await Promise.allSettled([
      ...this.unsubscribeChannels(this.notificationPool.keys()),
      ...activeRestores.map(([channel, restore]) =>
        this.waitForActiveRestore(channel, restore)
      ),
      ...pendingRegistrations.map((registration, index) =>
        this.waitForPendingRegistration(index, registration)
      ),
    ]);

    const remainingChannels = Array.from(this.notificationPool.keys());
    remainingChannels.forEach((channel) => {
      this.cancelNotificationRestore(channel);
    });
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
   * Marks one vendor queue as closing and returns its current tail snapshot.
   * Concrete adapters reject new queue entries synchronously in this hook.
   */
  protected beginNotificationQueueClose(
    _channelName: string
  ): Promise<void> | undefined {
    return undefined;
  }

  /** Removes vendor queue state after its connection cleanup has completed. */
  protected completeNotificationQueueClose(_channelName: string): void {
    return;
  }

  /**
   * Runs per-channel unsubscribe exactly once after draining the callback tail.
   * A bounded timeout prevents a hung user callback (including one awaiting
   * unlisten itself) from blocking connection cleanup forever.
   */
  protected closeNotificationChannel(
    channelName: string,
    closeConnection: () => Promise<void>
  ): Promise<void> {
    const activeClose = this.notificationClosePromises.get(channelName);
    if (activeClose) return activeClose;

    const queueTail = this.beginNotificationQueueClose(channelName);
    const closePromise = (async (): Promise<void> => {
      try {
        if (queueTail) {
          await this.waitForNotificationQueueTail(channelName, queueTail);
        }
        await closeConnection();
      } finally {
        this.completeNotificationQueueClose(channelName);
      }
    })();
    this.notificationClosePromises.set(channelName, closePromise);
    const clearClosePromise = (): void => {
      if (this.notificationClosePromises.get(channelName) === closePromise) {
        this.notificationClosePromises.delete(channelName);
      }
    };
    void closePromise.then(clearClosePromise, clearClosePromise);
    return closePromise;
  }

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
    }, options.intervalMs);
    timer.unref();
    this.getOrCreateIRestoreState(options.channelName).healthCheckTimer = timer;
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
    this.deleteIRestoreStateIfIdle(channelName, state);
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
    this.deleteIRestoreStateIfIdle(channelName, state);
  }

  protected assertCanRegisterNotification(): void {
    if (this.isDestroyed) {
      throw new ServerError('Database notification adapter is shutting down');
    }
  }

  /**
   * Registers an in-flight subscription attempt before it can yield. Shutdown
   * waits for the attempt (with the same bounded timeout as restore work), and
   * the destroyed guard prevents a late attempt from publishing into the pool.
   */
  protected trackNotificationRegistration<TResult>(
    register: () => Promise<TResult>
  ): Promise<TResult> {
    this.assertCanRegisterNotification();
    const registration = Promise.resolve().then(() => {
      this.assertCanRegisterNotification();
      return register();
    });
    this.pendingNotificationRegistrations.add(registration);
    const clear = (): void => {
      this.pendingNotificationRegistrations.delete(registration);
    };
    void registration.then(clear, clear);
    return registration;
  }

  /**
   * Prevents queued restore work from recreating a notification after manual
   * unlisten or destroy.
   * @param channelName - channel or subscription name.
   */
  protected cancelNotificationRestore(channelName: string): void {
    this.getOrCreateIRestoreState(channelName).isCancelled = true;
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
    this.deleteIRestoreStateIfIdle(channelName, state);
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
    const state = this.getOrCreateIRestoreState(options.channelName);
    if (state.activeRestore) return state.activeRestore;
    const restorePromise = Promise.resolve()
      .then(() => this.restoreNotificationWithRetry(options))
      .finally(() => {
        if (state.activeRestore === restorePromise) {
          delete state.activeRestore;
          if (!this.isDestroyed) state.isCancelled = false;
          this.deleteIRestoreStateIfIdle(options.channelName, state);
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
    const activeState = this.getOrCreateIRestoreState(channelName);
    activeState.isHealthCheckInProgress = true;
    try {
      const isHealthy = await options.isHealthy(connection);
      if (isHealthy) return;
      if (this.notificationPool.get(channelName) !== connection) return;
      await options.restore();
    } finally {
      activeState.isHealthCheckInProgress = false;
      this.deleteIRestoreStateIfIdle(channelName, activeState);
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
    const maxRetries = options.maxRetries ?? DatabaseNotify.RESTORE_MAX_RETRIES;
    const retryDelayMs =
      options.retryDelayMs ?? DatabaseNotify.RESTORE_RETRY_DELAY_MS;
    const retryAfterMaxDelayMs =
      options.retryAfterMaxDelayMs ??
      DatabaseNotify.RESTORE_RETRY_AFTER_MAX_DELAY_MS;
    let currentRetry =
      options.currentRetry ?? DatabaseNotify.RESTORE_CURRENT_RETRY;

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
          currentRetry = DatabaseNotify.RESTORE_CURRENT_RETRY;
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
    const state = this.getOrCreateIRestoreState(channelName);
    return new Promise((resolve) => {
      const complete = (): void => {
        clearTimeout(timer);
        if (state.cancelRetryDelay === complete) {
          delete state.cancelRetryDelay;
        }
        this.deleteIRestoreStateIfIdle(channelName, state);
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
          `Timed out waiting ${DatabaseNotify.DESTROY_RESTORE_WAIT_TIMEOUT_MS}ms for notification restore ${channelName} during shutdown; continuing cleanup`
        );
        complete();
      }, DatabaseNotify.DESTROY_RESTORE_WAIT_TIMEOUT_MS);
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

  private waitForPendingRegistration(
    index: number,
    registration: Promise<unknown>
  ): Promise<void> {
    return this.waitForShutdownTask(
      registration,
      `notification registration ${index + 1}`
    );
  }

  private waitForNotificationQueueTail(
    channelName: string,
    queueTail: Promise<void>
  ): Promise<void> {
    return this.waitForShutdownTask(
      queueTail,
      `notification callbacks on channel ${channelName}`
    );
  }

  private waitForShutdownTask(
    task: Promise<unknown>,
    description: string
  ): Promise<void> {
    return new Promise((resolve) => {
      let isSettled = false;
      const timer = setTimeout(() => {
        this.logger.warn(
          `Timed out waiting ${DatabaseNotify.DESTROY_RESTORE_WAIT_TIMEOUT_MS}ms for ${description} during shutdown; continuing cleanup`
        );
        complete();
      }, DatabaseNotify.DESTROY_RESTORE_WAIT_TIMEOUT_MS);
      const complete = (): void => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        resolve();
      };
      timer.unref();
      void task.then(complete, complete);
    });
  }

  private stopAllConnectionHealthChecks(): void {
    this.restoreStates.forEach((state, channelName) => {
      if (!state.healthCheckTimer) return;
      clearInterval(state.healthCheckTimer);
      delete state.healthCheckTimer;
      this.deleteIRestoreStateIfIdle(channelName, state);
    });
  }

  private getOrCreateIRestoreState(channelName: string): IRestoreState {
    const existingState = this.restoreStates.get(channelName);
    if (existingState) return existingState;
    const state: IRestoreState = {
      isCancelled: false,
      isHealthCheckInProgress: false,
    };
    this.restoreStates.set(channelName, state);
    return state;
  }

  private deleteIRestoreStateIfIdle(
    channelName: string,
    state: IRestoreState
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
