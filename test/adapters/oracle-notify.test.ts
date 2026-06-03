import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleNotify } from '../../src/adapters/oracle/oracle-notify.js';
import { createLogger } from '../support/helpers.js';

describe('OracleNotify', (): void => {
  it('builds package notification SQL with validated package names', (): void => {
    const notify = new OracleNotify({} as never, createLogger());

    expect(notify.getPackagesNotifySql(['pkg_one', 'pkgTwo'])).toContain(
      "NAME = 'PKG_ONE' OR NAME = 'PKGTWO'"
    );
    expect((): void => {
      notify.getPackagesNotifySql([]);
    }).toThrow('At least one package is required');
    expect((): void => {
      notify.getPackagesNotifySql(['pkg;drop']);
    }).toThrow('Unsafe SQL identifier');
  });

  it('unsubscribes a channel and closes its connection', async (): Promise<void> => {
    const connection = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    notify.getNotificationPool().set('channel', connection as never);

    await notify.unlistenNotify('channel');

    expect(connection.unsubscribe).toHaveBeenCalledWith('channel');
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
  });

  it('unsubscribes each operation subscription and closes connections', async (): Promise<void> => {
    const connectionA = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const connectionB = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    notify.getNotificationPool().set('a', connectionA as never);
    notify.getNotificationPool().set('b', connectionB as never);

    await notify.unlistenNotify('a');
    await notify.unlistenNotify('b');

    expect(connectionA.unsubscribe).toHaveBeenCalledWith('a');
    expect(connectionB.unsubscribe).toHaveBeenCalledWith('b');
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledTimes(2);
  });

  it('closes the connection even when unsubscribe fails', async (): Promise<void> => {
    const error = new Error('NJS-003: invalid or closed connection');
    const connection = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockRejectedValue(error),
    };
    const oracleConnection = {
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    notify.getNotificationPool().set('channel', connection as never);
    await notify.unlistenNotify('channel');

    expect(connection.unsubscribe).toHaveBeenCalledWith('channel');
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
  });

  it('cleans up registered operation subscriptions when batch registration fails', async (): Promise<void> => {
    const firstConnection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockResolvedValue(undefined),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockRejectedValue(new Error('subscribe failed')),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    await expect(
      notify.listenNotify('SELECT * FROM table_name', vi.fn(), {
        operations: [1, 2],
      })
    ).rejects.toThrow('subscribe failed');

    expect(firstConnection.unsubscribe).toHaveBeenCalledTimes(1);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('rejects registration after destroy without creating a connection', async (): Promise<void> => {
    const oracleConnection = {
      createSingleConnection: vi.fn(),
      closeSingleConnection: vi.fn(),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    await notify.destroy();

    await expect(
      notify.listenNotify('SELECT * FROM table_name', vi.fn())
    ).rejects.toThrow('Database notification adapter is shutting down');
    expect(oracleConnection.createSingleConnection).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('closes a connection when destroy races with subscription registration', async (): Promise<void> => {
    let resolveSubscribe!: () => void;
    let subscribeStarted!: () => void;
    const subscribePromise = new Promise<void>((resolve) => {
      resolveSubscribe = resolve;
    });
    const subscribeStartedPromise = new Promise<void>((resolve) => {
      subscribeStarted = resolve;
    });
    const connection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockImplementation(() => {
          subscribeStarted();
          return subscribePromise;
        }),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValue(connection),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const registration = notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn()
    );
    await subscribeStartedPromise;
    await notify.destroy();
    resolveSubscribe();

    await expect(registration).rejects.toThrow(
      'Database notification adapter is shutting down'
    );
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('does not keep a restored subscription when manual unlisten races with resubscribe', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let resolveSecondSubscribe!: () => void;
    let secondSubscribeStarted!: () => void;
    const secondSubscribePromise = new Promise<void>((resolve) => {
      resolveSecondSubscribe = resolve;
    });
    const secondSubscribeStartedPromise = new Promise<void>((resolve) => {
      secondSubscribeStarted = resolve;
    });
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            _options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation(() => {
          secondSubscribeStarted();
          return secondSubscribePromise;
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    void capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    await secondSubscribeStartedPromise;

    await notify.unlistenNotify(channelName);
    resolveSecondSubscribe();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(firstConnection.unsubscribe).toHaveBeenCalledWith(channelName);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    await vi.waitFor(() => {
      expect(notify.getNotificationPool().has(channelName)).toBe(false);
    });
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
  });

  it('waits for an in-flight restore and closes the restored subscription during destroy', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let resolveSecondSubscribe!: () => void;
    let secondSubscribeStarted!: () => void;
    const secondSubscribePromise = new Promise<void>((resolve) => {
      resolveSecondSubscribe = resolve;
    });
    const secondSubscribeStartedPromise = new Promise<void>((resolve) => {
      secondSubscribeStarted = resolve;
    });
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            _options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation(() => {
          secondSubscribeStarted();
          return secondSubscribePromise;
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    void capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    await secondSubscribeStartedPromise;

    let destroySettled = false;
    const destroyPromise = notify.destroy().then(() => {
      destroySettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(destroySettled).toBe(false);

    resolveSecondSubscribe();
    await destroyPromise;

    expect(notify.getNotificationPool().has(channelName)).toBe(false);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
  });

  it('keeps a successfully restored subscription under the same channel', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            _options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    await capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    await vi.waitFor(() => {
      expect(notify.getNotificationPool().get(channelName)).toBe(
        secondConnection
      );
    });
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    expect(oracleConnection.closeSingleConnection).not.toHaveBeenCalledWith(
      secondConnection
    );
  });

  it('preserves server-initiated CQN port when restoring a subscription', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let restoredOptions: oracledb.SubscribeOptions | undefined;
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          restoredOptions = options;
          return Promise.resolve();
        }),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {
        clientInitiated: false,
        cqnPort: 12345,
      }
    );
    await capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);

    await vi.waitFor(() => {
      expect(notify.getNotificationPool().get(channelName)).toBe(
        secondConnection
      );
    });
    expect(restoredOptions?.clientInitiated).toBe(false);
    expect(restoredOptions?.port).toBe(12345);
  });

  it('ignores stale restore callbacks after manual unlisten', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    const connection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValue(connection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    await notify.unlistenNotify(channelName);
    await capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);

    expect(oracleConnection.createSingleConnection).toHaveBeenCalledTimes(1);
    expect(notify.getNotificationPool().has(channelName)).toBe(false);
  });
});
