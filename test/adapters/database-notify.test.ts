import type { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseNotify } from '../../src/adapters/abstract/database-notify.js';
import type { ILoggerModule } from '../../src/types/logger.types.js';
import type {
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../src/types/notification.types.js';
import { createLogger } from '../support/helpers.js';

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
    restore: () => Promise<void>
  ): Promise<void> {
    return this.restoreNotification({
      channelName,
      settings: undefined,
      restore,
      maxRetries: 1,
      retryAfterMaxDelayMs: 60_000,
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

      let destroySettled = false;
      const destroyPromise = notify.destroy().then(() => {
        destroySettled = true;
      });
      await Promise.resolve();

      expect(destroySettled).toBe(false);

      await vi.advanceTimersByTimeAsync(5_000);
      await destroyPromise;

      expect(destroySettled).toBe(true);
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
});
