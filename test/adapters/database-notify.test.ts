import { describe, expect, it, vi } from 'vitest';

import { DatabaseNotify } from '../../src/adapters/abstract/database-notify.js';
import { createLogger } from '../support/helpers.js';

import type { ILoggerModule } from '../../src/types/logger.types.js';
import type {
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../src/types/notification.types.js';
import type { Client } from 'pg';

class TestDatabaseNotify extends DatabaseNotify<Client> {
  public constructor(logger: ILoggerModule) {
    super(logger);
  }

  public override async unlistenNotify(channel: string): Promise<void> {
    this.cancelNotificationRestore(channel);
    this.notificationPool.delete(channel);
    this.clearNotificationRestoreState(channel);
  }

  public override async listenNotify<T>(
    _sqlCommand: string,
    _notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    _options?: INotifyRetryOptions
  ): Promise<string> {
    return 'channel';
  }

  public restore(
    channelName: string,
    restore: () => Promise<void>,
    options: INotifyRetryOptions = {}
  ): Promise<void> {
    return this.restoreNotification({
      channelName,
      settings: undefined,
      restore,
      maxRetries: 1,
      retryAfterMaxDelayMs: 60_000,
      ...options,
    });
  }

  public startHealthCheck(
    connection: Client,
    isHealthy: () => Promise<boolean>
  ): void {
    this.startConnectionHealthCheck({
      channelName: 'channel',
      connection,
      intervalMs: 1,
      isHealthy,
      restore: vi.fn(),
    });
  }
}

describe('DatabaseNotify', (): void => {
  it('cancels retry delays and waits for active restores during destroy', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const notify = new TestDatabaseNotify(createLogger());
      const restore = vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error('restore failed'));
      const restorePromise = notify.restore('channel', restore);
      await Promise.resolve();
      await Promise.resolve();

      expect(restore).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(1);

      await notify.destroy();
      await restorePromise;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('times out waiting for a hung active restore during destroy', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const logger = createLogger();
      const notify = new TestDatabaseNotify(logger);
      const restore = vi
        .fn<() => Promise<void>>()
        .mockReturnValue(new Promise<void>(() => undefined));

      void notify.restore('channel', restore);
      await Promise.resolve();
      await Promise.resolve();

      let isDestroySettled = false;
      const destroyPromise = notify.destroy().then(() => {
        isDestroySettled = true;
      });
      await Promise.resolve();

      expect(isDestroySettled).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      await destroyPromise;

      expect(isDestroySettled).toBe(true);
      expect(notify.getNotificationPool().size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Timed out waiting 5000ms for notification restore channel during shutdown'
        )
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not start health checks or restores after destroy', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const notify = new TestDatabaseNotify(createLogger());
      const isHealthy = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
      const restore = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await notify.destroy();
      notify.startHealthCheck({} as Client, isHealthy);
      await notify.restore('channel', restore);
      await vi.advanceTimersByTimeAsync(10);

      expect(isHealthy).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('cancels a channel retry delay immediately during manual unlisten', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const notify = new TestDatabaseNotify(createLogger());
      const failedRestore = vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error('restore failed'));
      const restorePromise = notify.restore('channel', failedRestore);
      await Promise.resolve();
      await Promise.resolve();

      expect(failedRestore).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(1);

      await notify.unlistenNotify('channel');
      await restorePromise;

      expect(vi.getTimerCount()).toBe(0);

      const nextRestore = vi
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined);
      await notify.restore('channel', nextRestore);

      expect(nextRestore).toHaveBeenCalledOnce();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it.each([
    { option: 'maxRetries', value: 0 },
    { option: 'maxRetries', value: -1 },
    { option: 'maxRetries', value: 1.5 },
    { option: 'maxRetries', value: Number.NaN },
    { option: 'maxRetries', value: Infinity },
    { option: 'retryDelayMs', value: -1 },
    { option: 'retryDelayMs', value: 1.5 },
    { option: 'retryDelayMs', value: Number.NaN },
    { option: 'retryDelayMs', value: Infinity },
    { option: 'retryAfterMaxDelayMs', value: -1 },
    { option: 'retryAfterMaxDelayMs', value: 1.5 },
    { option: 'retryAfterMaxDelayMs', value: Number.NaN },
    { option: 'retryAfterMaxDelayMs', value: Infinity },
  ])('rejects invalid $option value $value', ({ option, value }): void => {
    const notify = new TestDatabaseNotify(createLogger());

    expect(() =>
      notify.restore('channel', vi.fn(), {
        [option]: value,
      })
    ).toThrow(RangeError);
  });
});
