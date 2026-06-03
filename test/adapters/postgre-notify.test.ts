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
    await notify.destroy();
    resolveListen();

    await expect(registration).rejects.toThrow(
      'Database notification adapter is shutting down'
    );
    expect(connection.closeSingleConnection).toHaveBeenCalledWith(client);
    expect(connection.registerConnectionErrorHandler).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().size).toBe(0);
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
    connectionLossCallback();
    await secondListenStartedPromise;

    let destroySettled = false;
    const destroyPromise = notify.destroy().then(() => {
      destroySettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(destroySettled).toBe(false);

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
    connectionLossCallback();
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
    firstConnectionLossCallback();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(notify.getNotificationPool().get('channel_name')).toBe(
      replacementClient
    );
    expect(connection.createSingleConnection).toHaveBeenCalledTimes(2);
  });
});
