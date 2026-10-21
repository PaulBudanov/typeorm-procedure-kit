import { describe, expect, it, vi } from 'vitest';

import { DatabaseNotify } from '../../src/adapters/abstract/database-notify.js';
import { OracleNotify } from '../../src/adapters/oracle/oracle-notify.js';
import { PostgreNotify } from '../../src/adapters/postgres/postgre-notify.js';
import { createLogger } from '../support/helpers.js';

import type { ILoggerModule } from '../../src/types/logger.types.js';
import type {
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../src/types/notification.types.js';
import type { Client } from 'pg';

/** Minimal view of the vendor helper the base class closes connections with. */
interface INotifyConnectionHelper {
  closeSingleConnection(connection: Client): Promise<void>;
  isSingleConnectionHealthy(
    connection: Client,
    timeoutMs?: number
  ): Promise<boolean>;
}

interface ILifecycleHooks {
  queueTail?: Promise<void>;
  unsubscribe?: () => Promise<void>;
}

/**
 * Vendor-neutral notifier used to pin the close choreography that the base
 * class owns: every adapter must go through these steps in this order.
 */
class LifecycleNotify extends DatabaseNotify<Client> {
  public constructor(
    logger: ILoggerModule,
    connection: INotifyConnectionHelper,
    private readonly calls: Array<string>,
    private readonly hooks: ILifecycleHooks = {}
  ) {
    super(logger, connection);
  }

  public override async listenNotify<T>(
    _sqlCommand: string,
    _notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    _options?: INotifyRetryOptions
  ): Promise<string> {
    return 'channel';
  }

  public override async unlistenNotify(channel: string): Promise<void> {
    await this.closeNotificationSubscription(channel);
  }

  public addPooledConnection(channel: string, connection: Client): void {
    this.notificationPool.set(channel, connection);
  }

  public isPooled(channel: string): boolean {
    return this.notificationPool.has(channel);
  }

  protected override cancelNotificationRestore(channelName: string): void {
    this.calls.push('cancelNotificationRestore');
    super.cancelNotificationRestore(channelName);
  }

  protected override stopConnectionHealthCheck(channelName: string): void {
    this.calls.push('stopConnectionHealthCheck');
    super.stopConnectionHealthCheck(channelName);
  }

  protected override clearNotificationRestoreState(channelName: string): void {
    this.calls.push('clearNotificationRestoreState');
    super.clearNotificationRestoreState(channelName);
  }

  protected override beginNotificationQueueClose(
    channelName: string
  ): Promise<void> | undefined {
    this.calls.push('beginNotificationQueueClose');
    return (
      this.hooks.queueTail ?? super.beginNotificationQueueClose(channelName)
    );
  }

  protected override completeNotificationQueueClose(channelName: string): void {
    this.calls.push('completeNotificationQueueClose');
    super.completeNotificationQueueClose(channelName);
  }

  protected override unsubscribeNotificationConnection(
    _channelName: string,
    _connection: Client
  ): Promise<void> {
    this.calls.push('unsubscribeNotificationConnection');
    return this.hooks.unsubscribe?.() ?? Promise.resolve();
  }
}

function createConnectionHelper(
  calls: Array<string>,
  overrides: Partial<INotifyConnectionHelper> = {}
): INotifyConnectionHelper {
  return {
    isSingleConnectionHealthy: vi.fn(
      (_connection: Client, timeoutMs?: number) => {
        calls.push(`isSingleConnectionHealthy:${String(timeoutMs)}`);
        return Promise.resolve(true);
      }
    ),
    closeSingleConnection: vi.fn((_connection: Client) => {
      calls.push('closeSingleConnection');
      return Promise.resolve();
    }),
    ...overrides,
  };
}

function neverSettles<TResult>(): Promise<TResult> {
  return new Promise<TResult>(() => undefined);
}

describe('notification close lifecycle', (): void => {
  it('runs the shared close choreography in one fixed order', async (): Promise<void> => {
    const calls: Array<string> = [];
    const logger = createLogger();
    const helper = createConnectionHelper(calls);
    const queueTail = Promise.resolve().then((): void => {
      calls.push('drainedCallbacks');
    });
    const notify = new LifecycleNotify(logger, helper, calls, {
      queueTail,
      unsubscribe: () => {
        calls.push(`pooledDuringUnsubscribe:${String(notify.isPooled('ch'))}`);
        return Promise.resolve();
      },
    });
    notify.addPooledConnection('ch', {} as Client);

    await notify.unlistenNotify('ch');

    expect(calls).toEqual([
      'cancelNotificationRestore',
      'stopConnectionHealthCheck',
      'beginNotificationQueueClose',
      'drainedCallbacks',
      'clearNotificationRestoreState',
      'isSingleConnectionHealthy:500',
      'unsubscribeNotificationConnection',
      'pooledDuringUnsubscribe:false',
      'closeSingleConnection',
      'completeNotificationQueueClose',
    ]);
    expect(logger.log).toHaveBeenCalledWith('Unsubscribed from channel: ch');
  });

  it('skips the vendor unsubscribe but still closes a dead connection', async (): Promise<void> => {
    const calls: Array<string> = [];
    const helper = createConnectionHelper(calls, {
      isSingleConnectionHealthy: vi.fn(
        (_connection: Client, timeoutMs?: number) => {
          calls.push(`isSingleConnectionHealthy:${String(timeoutMs)}`);
          return Promise.resolve(false);
        }
      ),
    });
    const notify = new LifecycleNotify(createLogger(), helper, calls);
    notify.addPooledConnection('ch', {} as Client);

    await notify.unlistenNotify('ch');

    expect(calls).toEqual([
      'cancelNotificationRestore',
      'stopConnectionHealthCheck',
      'beginNotificationQueueClose',
      'clearNotificationRestoreState',
      'isSingleConnectionHealthy:500',
      'closeSingleConnection',
      'completeNotificationQueueClose',
    ]);
  });

  it('reports a failed unsubscribe and closes the connection anyway', async (): Promise<void> => {
    const calls: Array<string> = [];
    const logger = createLogger();
    const helper = createConnectionHelper(calls);
    const notify = new LifecycleNotify(logger, helper, calls, {
      unsubscribe: () => Promise.reject(new Error('unsubscribe failed')),
    });
    notify.addPooledConnection('ch', {} as Client);

    await notify.unlistenNotify('ch');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Error unsubscribing from channel ch: unsubscribe failed'
      ),
      expect.anything()
    );
    expect(helper.closeSingleConnection).toHaveBeenCalledTimes(1);
    expect(notify.isPooled('ch')).toBe(false);
  });

  it('warns when the channel has no pooled connection', async (): Promise<void> => {
    const calls: Array<string> = [];
    const logger = createLogger();
    const helper = createConnectionHelper(calls);
    const notify = new LifecycleNotify(logger, helper, calls);

    await notify.unlistenNotify('ch');

    expect(logger.warn).toHaveBeenCalledWith(
      'No active notification connection for channel: ch'
    );
    expect(helper.isSingleConnectionHealthy).not.toHaveBeenCalled();
    expect(helper.closeSingleConnection).not.toHaveBeenCalled();
  });

  it('closes a PostgreSQL listener through the shared choreography', async (): Promise<void> => {
    const calls: Array<string> = [];
    const client = {
      query: vi.fn((sql: string) => {
        calls.push(`query:${sql}`);
        return Promise.resolve(undefined);
      }),
    };
    const connection = {
      createSingleConnection: vi.fn(),
      registerConnectionErrorHandler: vi.fn(),
      ...createConnectionHelper(calls),
    };
    const notify = new PostgreNotify(connection as never, createLogger());
    notify.getNotificationPool().set('channel_name', client as never);

    await notify.unlistenNotify('channel_name');

    expect(calls).toEqual([
      'isSingleConnectionHealthy:500',
      'query:UNLISTEN "channel_name"',
      'closeSingleConnection',
    ]);
    expect(notify.getNotificationPool().has('channel_name')).toBe(false);
  });

  it('closes an Oracle subscription through the shared choreography', async (): Promise<void> => {
    const calls: Array<string> = [];
    const connection = {
      unsubscribe: vi.fn((channel: string) => {
        calls.push(`unsubscribe:${channel}`);
        return Promise.resolve(undefined);
      }),
    };
    const oracleConnection = {
      createSingleConnection: vi.fn(),
      registerConnectionErrorHandler: vi.fn(),
      ...createConnectionHelper(calls),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());
    notify.getNotificationPool().set('channel_name', connection as never);

    await notify.unlistenNotify('channel_name');

    expect(calls).toEqual([
      'isSingleConnectionHealthy:500',
      'unsubscribe:channel_name',
      'closeSingleConnection',
    ]);
    expect(notify.getNotificationPool().has('channel_name')).toBe(false);
  });

  it('completes destroy when a pooled channel unsubscribe never settles', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const calls: Array<string> = [];
      const logger = createLogger();
      const helper = createConnectionHelper(calls);
      const notify = new LifecycleNotify(logger, helper, calls, {
        unsubscribe: () => neverSettles<void>(),
      });
      notify.addPooledConnection('ch', {} as Client);

      let isDestroySettled = false;
      const destroyPromise = notify.destroy().then((): void => {
        isDestroySettled = true;
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(isDestroySettled).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      await destroyPromise;

      expect(isDestroySettled).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Timed out waiting 5000ms for notification unsubscribe on channel ch during shutdown'
        )
      );
      expect(notify.getNotificationPool().size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('completes destroy when a pooled PostgreSQL client close never settles', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const logger = createLogger();
      const client = {
        query: vi.fn(() => Promise.resolve(undefined)),
      };
      const connection = {
        createSingleConnection: vi.fn(),
        registerConnectionErrorHandler: vi.fn(),
        isSingleConnectionHealthy: vi.fn(() => Promise.resolve(true)),
        closeSingleConnection: vi.fn(() => neverSettles<void>()),
      };
      const notify = new PostgreNotify(connection as never, logger);
      notify.getNotificationPool().set('channel_name', client as never);

      let isDestroySettled = false;
      const destroyPromise = notify.destroy().then((): void => {
        isDestroySettled = true;
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(isDestroySettled).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      await destroyPromise;

      expect(isDestroySettled).toBe(true);
      expect(connection.closeSingleConnection).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Timed out waiting 5000ms for notification unsubscribe on channel channel_name during shutdown'
        )
      );
      expect(notify.getNotificationPool().size).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
