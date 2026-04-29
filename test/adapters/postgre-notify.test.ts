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
});
