import { describe, expect, it, vi } from 'vitest';

import { DatabaseNotify } from '../../src/adapters/abstract/database-notify.js';
import { createLogger } from '../support/helpers.js';

import type { ILoggerModule } from '../../src/types/logger.types.js';
import type {
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../src/types/notification.types.js';
import type { Client } from 'pg';

/**
 * Structural view over the private shutdown bookkeeping containers, so the
 * tests can assert on them without widening the production surface.
 */
interface IShutdownContainers {
  readonly notificationClosePromises: Map<string, Promise<void>>;
  readonly pendingNotificationRegistrations: Set<Promise<unknown>>;
}

class ShutdownContainerNotify extends DatabaseNotify<Client> {
  public constructor(logger: ILoggerModule) {
    super(logger);
  }

  public override async unlistenNotify(channel: string): Promise<void> {
    this.notificationPool.delete(channel);
  }

  public override async listenNotify<T>(
    _sqlCommand: string,
    _notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    _options?: INotifyRetryOptions
  ): Promise<string> {
    return 'channel';
  }

  public closeChannel(
    channelName: string,
    closeConnection: () => Promise<void>
  ): Promise<void> {
    return this.closeNotificationChannel(channelName, closeConnection);
  }

  public trackRegistration<TResult>(
    register: () => Promise<TResult>
  ): Promise<TResult> {
    return this.trackNotificationRegistration(register);
  }

  public get containers(): IShutdownContainers {
    return this as unknown as IShutdownContainers;
  }
}

function neverSettles<TResult>(): Promise<TResult> {
  return new Promise<TResult>(() => undefined);
}

describe('DatabaseNotify shutdown bookkeeping', (): void => {
  it('drops a channel close that never settles when destroy completes', async (): Promise<void> => {
    const notify = new ShutdownContainerNotify(createLogger());
    const hungClose = notify.closeChannel('channel', () =>
      neverSettles<void>()
    );
    void hungClose.catch((): void => undefined);

    expect(notify.containers.notificationClosePromises.size).toBe(1);

    await notify.destroy();

    expect(notify.containers.notificationClosePromises.size).toBe(0);
  });

  it('drops a registration that never settles when destroy completes', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const notify = new ShutdownContainerNotify(createLogger());
      const hungRegistration = notify.trackRegistration(() =>
        neverSettles<string>()
      );
      void hungRegistration.catch((): void => undefined);
      await Promise.resolve();
      await Promise.resolve();

      expect(notify.containers.pendingNotificationRegistrations.size).toBe(1);

      const destroyPromise = notify.destroy();
      await vi.advanceTimersByTimeAsync(10_000);
      await destroyPromise;

      expect(notify.containers.pendingNotificationRegistrations.size).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('still removes a settled channel close without waiting for destroy', async (): Promise<void> => {
    const notify = new ShutdownContainerNotify(createLogger());

    await notify.closeChannel('channel', () => Promise.resolve());

    expect(notify.containers.notificationClosePromises.size).toBe(0);
  });
});
