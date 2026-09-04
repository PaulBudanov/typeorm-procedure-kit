import { EventEmitter } from 'events';

import { describe, expect, it, vi } from 'vitest';

import { PostgreNotify } from '../../src/adapters/postgres/postgre-notify.js';
import { PostgreSqlCommand } from '../../src/adapters/postgres/postgre-sql.js';
import { createLogger } from '../support/helpers.js';

class FakePgClient extends EventEmitter {
  public readonly query = vi.fn<(_sql: string) => Promise<unknown>>();
}

describe('PostgreNotify', (): void => {
  it('returns default and custom package notification SQL', (): void => {
    const connection = {
      createSingleConnection: vi.fn(),
      closeSingleConnection: vi.fn(),
      registerConnectionErrorHandler: vi.fn(),
    };

    expect(
      new PostgreNotify(
        connection as never,
        createLogger()
      ).getPackagesNotifySql()
    ).toBe(PostgreSqlCommand.SQL_GET_NOTIFY_UPDATE_PACKAGE);
    expect(
      new PostgreNotify(
        connection as never,
        createLogger(),
        'custom_event'
      ).getPackagesNotifySql()
    ).toBe('LISTEN "custom_event"');
  });

  it.each([
    { maxRetries: 0 },
    { maxRetries: Number.NaN },
    { retryDelayMs: -1 },
    { retryDelayMs: Infinity },
    { retryAfterMaxDelayMs: 1.5 },
  ])(
    'rejects invalid retry options before opening a connection',
    async (options) => {
      const createSingleConnection = vi.fn();
      const notify = new PostgreNotify(
        { createSingleConnection } as never,
        createLogger()
      );

      await expect(
        notify.listenNotify('LISTEN channel_name', vi.fn(), options)
      ).rejects.toThrow(RangeError);
      expect(createSingleConnection).not.toHaveBeenCalled();
    }
  );

  it('registers, receives, and unregisters notifications', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockResolvedValue(undefined);
    const callback = vi.fn<(_payload: { ok: boolean }) => void>();
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValue(client),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
      isSingleConnectionHealthy: vi
        .fn<(_client: FakePgClient, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await expect(
      notify.listenNotify('LISTEN "db_object_event"', callback)
    ).resolves.toBe('db_object_event');
    client.emit('notification', {
      channel: 'db_object_event',
      payload: '{"ok":true}',
    });
    await Promise.resolve();

    expect(client.query).toHaveBeenCalledWith('LISTEN "db_object_event"');
    expect(callback).toHaveBeenCalledWith({ ok: true });

    await notify.unlistenNotify('db_object_event');

    expect(client.query).toHaveBeenLastCalledWith('UNLISTEN "db_object_event"');
    expect(connection.closeSingleConnection).toHaveBeenCalledWith(client);
  });

  it('serializes callbacks and bounds the per-channel notification queue', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockResolvedValue(undefined);
    let releaseFirst!: () => void;
    const firstCallback = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let activeCallbacks = 0;
    let maxActiveCallbacks = 0;
    const callback = vi.fn(async () => {
      activeCallbacks += 1;
      maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks);
      if (callback.mock.calls.length === 1) await firstCallback;
      activeCallbacks -= 1;
    });
    const connection = {
      createSingleConnection: vi.fn().mockResolvedValue(client),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
    };
    const logger = createLogger();
    const notify = new PostgreNotify(connection as never, logger, undefined, 2);
    await notify.listenNotify('LISTEN bounded_channel', callback);

    client.emit('notification', {
      channel: 'bounded_channel',
      payload: '{"id":1}',
    });
    client.emit('notification', {
      channel: 'bounded_channel',
      payload: '{"id":2}',
    });
    client.emit('notification', {
      channel: 'bounded_channel',
      payload: '{"id":3}',
    });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    releaseFirst();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));

    expect(maxActiveCallbacks).toBe(1);
    expect(callback).toHaveBeenNthCalledWith(1, { id: 1 });
    expect(callback).toHaveBeenNthCalledWith(2, { id: 2 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('notification queue limit (2)')
    );
    await notify.unlistenNotify('bounded_channel');
  });

  it('drains active and queued callbacks before unlisten and rejects new events while closing', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockResolvedValue(undefined);
    let releaseFirst!: () => void;
    const firstCallback = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const callback = vi.fn(async () => {
      if (callback.mock.calls.length === 1) await firstCallback;
    });
    const connection = {
      createSingleConnection: vi.fn().mockResolvedValue(client),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
    };
    const notify = new PostgreNotify(connection as never, createLogger());
    await notify.listenNotify('LISTEN drain_channel', callback);

    client.emit('notification', {
      channel: 'drain_channel',
      payload: '{"id":1}',
    });
    client.emit('notification', {
      channel: 'drain_channel',
      payload: '{"id":2}',
    });
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());

    const unlistenPromise = notify.unlistenNotify('drain_channel');
    client.emit('notification', {
      channel: 'drain_channel',
      payload: '{"id":3}',
    });
    await Promise.resolve();
    expect(connection.closeSingleConnection).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalledWith('UNLISTEN "drain_channel"');

    releaseFirst();
    await unlistenPromise;

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(2, { id: 2 });
    expect(connection.closeSingleConnection).toHaveBeenCalledWith(client);
  });

  it('times out a hung callback and keeps destroy idempotent', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const client = new FakePgClient();
      client.query.mockResolvedValue(undefined);
      const connection = {
        createSingleConnection: vi.fn().mockResolvedValue(client),
        closeSingleConnection: vi.fn().mockResolvedValue(undefined),
        registerConnectionErrorHandler: vi.fn(),
        isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      };
      const logger = createLogger();
      const notify = new PostgreNotify(connection as never, logger);
      await notify.listenNotify(
        'LISTEN hung_channel',
        () => new Promise<void>(() => undefined)
      );
      client.emit('notification', {
        channel: 'hung_channel',
        payload: '{}',
      });
      await Promise.resolve();
      await Promise.resolve();

      const firstDestroy = notify.destroy();
      const secondDestroy = notify.destroy();
      expect(secondDestroy).toBe(firstDestroy);
      expect(connection.closeSingleConnection).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      await firstDestroy;

      expect(connection.closeSingleConnection).toHaveBeenCalledWith(client);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Timed out waiting 5000ms for notification callbacks on channel hung_channel'
        )
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not echo malformed notification payloads into logs', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockResolvedValue(undefined);
    const connection = {
      createSingleConnection: vi.fn().mockResolvedValue(client),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
    };
    const logger = createLogger();
    const callback = vi.fn();
    const notify = new PostgreNotify(connection as never, logger);
    await notify.listenNotify('LISTEN secure_channel', callback);
    const secretPayload = 'secret-token\nforged-log-line';

    client.emit('notification', {
      channel: 'secure_channel',
      payload: secretPayload,
    });
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith(secretPayload)
    );

    const loggedMessages = logger.error.mock.calls.map(([message]) =>
      String(message)
    );
    expect(loggedMessages.join('\n')).not.toContain(secretPayload);
    expect(loggedMessages.join('\n')).toContain('payload length');
    await notify.unlistenNotify('secure_channel');
  });

  it('rejects invalid LISTEN SQL and duplicate listeners', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockResolvedValue(undefined);
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValue(client),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await expect(notify.listenNotify('SELECT 1', vi.fn())).rejects.toThrow(
      'SQL command must contain LISTEN'
    );
    await notify.listenNotify('LISTEN channel_name', vi.fn());
    await expect(
      notify.listenNotify('LISTEN channel_name', vi.fn())
    ).rejects.toThrow('already registered');
  });

  it('enforces the PostgreSQL channel byte limit before connection creation', async (): Promise<void> => {
    const acceptedClient = new FakePgClient();
    acceptedClient.query.mockResolvedValue(undefined);
    const acceptedConnection = {
      createSingleConnection: vi.fn().mockResolvedValue(acceptedClient),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
    };
    const acceptedNotify = new PostgreNotify(
      acceptedConnection as never,
      createLogger()
    );
    const acceptedChannel = 'x'.repeat(63);
    await expect(
      acceptedNotify.listenNotify(`LISTEN ${acceptedChannel}`, vi.fn())
    ).resolves.toBe(acceptedChannel);
    await acceptedNotify.unlistenNotify(acceptedChannel);

    const rejectedConnection = {
      createSingleConnection: vi.fn(),
      closeSingleConnection: vi.fn(),
      registerConnectionErrorHandler: vi.fn(),
    };
    const rejectedChannel = 'secret_' + 'x'.repeat(57);
    const rejectedNotify = new PostgreNotify(
      rejectedConnection as never,
      createLogger(),
      rejectedChannel
    );
    const configuredListenSql = rejectedNotify.getPackagesNotifySql();
    try {
      await rejectedNotify.listenNotify(configuredListenSql, vi.fn());
      throw new Error('Expected oversized LISTEN channel to be rejected');
    } catch (error: unknown) {
      expect((error as Error).message).toBe(
        'PostgreSQL LISTEN channel exceeds 63 UTF-8 bytes'
      );
      expect((error as Error).message).not.toContain(rejectedChannel);
    }
    expect(rejectedConnection.createSingleConnection).not.toHaveBeenCalled();
  });

  it('closes a created client when LISTEN registration fails', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockRejectedValue(new Error('listen failed'));
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValue(client),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await expect(
      notify.listenNotify('LISTEN channel_name', vi.fn())
    ).rejects.toThrow('listen failed');

    expect(connection.closeSingleConnection).toHaveBeenCalledWith(client);
    expect(connection.registerConnectionErrorHandler).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().has('channel_name')).toBe(false);
  });

  it('rejects registration after destroy without creating a client', async (): Promise<void> => {
    const connection = {
      createSingleConnection: vi.fn(),
      closeSingleConnection: vi.fn(),
      registerConnectionErrorHandler: vi.fn(),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await notify.destroy();

    await expect(
      notify.listenNotify('LISTEN channel_name', vi.fn())
    ).rejects.toThrow('Database notification adapter is shutting down');
    expect(connection.createSingleConnection).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('closes a client when destroy races with LISTEN registration', async (): Promise<void> => {
    const client = new FakePgClient();
    let resolveListen!: () => void;
    let listenStarted!: () => void;
    const listenPromise = new Promise<void>((resolve) => {
      resolveListen = resolve;
    });
    const listenStartedPromise = new Promise<void>((resolve) => {
      listenStarted = resolve;
    });
    client.query.mockImplementation(() => {
      listenStarted();
      return listenPromise;
    });
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValue(client),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    const registration = notify.listenNotify('LISTEN channel_name', vi.fn());
    await listenStartedPromise;
    let isDestroySettled = false;
    const destroy = notify.destroy().then(() => {
      isDestroySettled = true;
    });
    await Promise.resolve();

    expect(isDestroySettled).toBe(false);
    expect(connection.closeSingleConnection).not.toHaveBeenCalled();
    resolveListen();

    await expect(registration).rejects.toThrow(
      'Database notification adapter is shutting down'
    );
    await destroy;
    expect(connection.closeSingleConnection).toHaveBeenCalledWith(client);
    expect(connection.closeSingleConnection).toHaveBeenCalledOnce();
    expect(connection.registerConnectionErrorHandler).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('times out a pending client creation without publishing it after shutdown', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const client = new FakePgClient();
      client.query.mockResolvedValue(undefined);
      let resolveConnection!: (value: FakePgClient) => void;
      const pendingConnection = new Promise<FakePgClient>((resolve) => {
        resolveConnection = resolve;
      });
      const connection = {
        createSingleConnection: vi.fn().mockReturnValue(pendingConnection),
        closeSingleConnection: vi.fn().mockResolvedValue(undefined),
        registerConnectionErrorHandler: vi.fn(),
      };
      const logger = createLogger();
      const notify = new PostgreNotify(connection as never, logger);

      const registration = notify.listenNotify('LISTEN late_channel', vi.fn());
      await Promise.resolve();
      const destroy = notify.destroy();
      await vi.advanceTimersByTimeAsync(5_000);
      await destroy;

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Timed out waiting 5000ms for notification registration'
        )
      );
      expect(notify.getNotificationPool().size).toBe(0);

      resolveConnection(client);
      await expect(registration).rejects.toThrow(
        'Database notification adapter is shutting down'
      );
      expect(connection.closeSingleConnection).toHaveBeenCalledOnce();
      expect(connection.registerConnectionErrorHandler).not.toHaveBeenCalled();
      expect(client.query).not.toHaveBeenCalled();
      await notify.destroy();
      expect(connection.closeSingleConnection).toHaveBeenCalledOnce();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('rejects a duplicate listener while the first registration is pending', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockResolvedValue(undefined);
    let resolveConnection!: (client: FakePgClient) => void;
    const connectionPromise = new Promise<FakePgClient>((resolve) => {
      resolveConnection = resolve;
    });
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockReturnValueOnce(connectionPromise),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(),
      isSingleConnectionHealthy: vi
        .fn<(_client: FakePgClient, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    const firstRegistration = notify.listenNotify(
      'LISTEN channel_name',
      vi.fn()
    );
    await Promise.resolve();

    await expect(
      notify.listenNotify('LISTEN channel_name', vi.fn())
    ).rejects.toThrow('Listener for channel "channel_name" already registered');

    resolveConnection(client);
    await expect(firstRegistration).resolves.toBe('channel_name');
    expect(connection.createSingleConnection).toHaveBeenCalledOnce();
  });

  it('keeps a successfully restored listener under the same channel', async (): Promise<void> => {
    const firstClient = new FakePgClient();
    firstClient.query.mockResolvedValue(undefined);
    const secondClient = new FakePgClient();
    secondClient.query.mockResolvedValue(undefined);
    let connectionLossCallback!: () => void | Promise<void>;
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(
        (_client: FakePgClient, callback: () => void | Promise<void>) => {
          connectionLossCallback = callback;
        }
      ),
      isSingleConnectionHealthy: vi
        .fn<(_client: FakePgClient, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await notify.listenNotify('LISTEN channel_name', vi.fn());
    await connectionLossCallback();

    await vi.waitFor(() => {
      expect(notify.getNotificationPool().get('channel_name')).toBe(
        secondClient
      );
    });
    expect(connection.closeSingleConnection).toHaveBeenCalledWith(firstClient);
    expect(connection.closeSingleConnection).not.toHaveBeenCalledWith(
      secondClient
    );
  });

  it('preserves a quoted mixed-case channel when restoring a listener', async (): Promise<void> => {
    const firstClient = new FakePgClient();
    firstClient.query.mockResolvedValue(undefined);
    const secondClient = new FakePgClient();
    secondClient.query.mockResolvedValue(undefined);
    let connectionLossCallback!: () => void | Promise<void>;
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(
        (_client: FakePgClient, callback: () => void | Promise<void>) => {
          connectionLossCallback = callback;
        }
      ),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await notify.listenNotify('LISTEN "MixedCase"', vi.fn());
    await connectionLossCallback();

    await vi.waitFor(() => {
      expect(notify.getNotificationPool().get('MixedCase')).toBe(secondClient);
    });

    expect(firstClient.query).toHaveBeenCalledWith('LISTEN "MixedCase"');
    expect(secondClient.query).toHaveBeenCalledWith('LISTEN "MixedCase"');
    await notify.unlistenNotify('MixedCase');
  });

  it('waits for an in-flight restore and closes the restored listener during destroy', async (): Promise<void> => {
    const firstClient = new FakePgClient();
    firstClient.query.mockResolvedValue(undefined);
    const secondClient = new FakePgClient();
    let resolveSecondListen!: () => void;
    let secondListenStarted!: () => void;
    const secondListenPromise = new Promise<void>((resolve) => {
      resolveSecondListen = resolve;
    });
    const secondListenStartedPromise = new Promise<void>((resolve) => {
      secondListenStarted = resolve;
    });
    secondClient.query.mockImplementation(() => {
      secondListenStarted();
      return secondListenPromise;
    });
    let connectionLossCallback!: () => void | Promise<void>;
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(secondClient),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(
        (_client: FakePgClient, callback: () => void | Promise<void>) => {
          connectionLossCallback = callback;
        }
      ),
      isSingleConnectionHealthy: vi
        .fn<(_client: FakePgClient, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await notify.listenNotify('LISTEN channel_name', vi.fn());
    void connectionLossCallback();
    await secondListenStartedPromise;

    let isDestroySettled = false;
    const destroyPromise = notify.destroy().then(() => {
      isDestroySettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(isDestroySettled).toBe(false);

    resolveSecondListen();
    await destroyPromise;

    expect(notify.getNotificationPool().has('channel_name')).toBe(false);
    expect(connection.closeSingleConnection).toHaveBeenCalledWith(firstClient);
    expect(connection.closeSingleConnection).toHaveBeenCalledWith(secondClient);
  });

  it('ignores stale connection-loss callbacks after manual unlisten', async (): Promise<void> => {
    const client = new FakePgClient();
    client.query.mockResolvedValue(undefined);
    let connectionLossCallback!: () => void | Promise<void>;
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValue(client),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(
        (_client: FakePgClient, callback: () => void | Promise<void>) => {
          connectionLossCallback = callback;
        }
      ),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await notify.listenNotify('LISTEN channel_name', vi.fn());
    await notify.unlistenNotify('channel_name');
    void connectionLossCallback();
    await Promise.resolve();

    expect(connection.createSingleConnection).toHaveBeenCalledTimes(1);
    expect(notify.getNotificationPool().has('channel_name')).toBe(false);
  });

  it('ignores a stale connection-loss callback after manual re-listen', async (): Promise<void> => {
    const firstClient = new FakePgClient();
    firstClient.query.mockResolvedValue(undefined);
    const replacementClient = new FakePgClient();
    replacementClient.query.mockResolvedValue(undefined);
    let firstConnectionLossCallback!: () => void | Promise<void>;
    const connection = {
      createSingleConnection: vi
        .fn<() => Promise<FakePgClient>>()
        .mockResolvedValueOnce(firstClient)
        .mockResolvedValueOnce(replacementClient),
      closeSingleConnection: vi
        .fn<(_client: FakePgClient) => Promise<void>>()
        .mockResolvedValue(undefined),
      registerConnectionErrorHandler: vi.fn(
        (_client: FakePgClient, callback: () => void | Promise<void>) => {
          firstConnectionLossCallback ??= callback;
        }
      ),
      isSingleConnectionHealthy: vi.fn(),
    };
    const notify = new PostgreNotify(connection as never, createLogger());

    await notify.listenNotify('LISTEN channel_name', vi.fn());
    await notify.unlistenNotify('channel_name');
    await notify.listenNotify('LISTEN channel_name', vi.fn());
    void firstConnectionLossCallback();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(notify.getNotificationPool().get('channel_name')).toBe(
      replacementClient
    );
    expect(connection.createSingleConnection).toHaveBeenCalledTimes(2);
  });
});
