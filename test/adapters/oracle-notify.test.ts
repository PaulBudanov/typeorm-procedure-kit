import { describe, expect, it, vi } from 'vitest';

import { OracleNotify } from '../../src/adapters/oracle/oracle-notify.js';
import { createLogger } from '../support/helpers.js';

describe('OracleNotify', (): void => {
  it('builds package notification SQL with validated package names', (): void => {
    const notify = new OracleNotify({} as never, createLogger(), {});

    expect(notify.getPackagesNotifySql(['pkg_one', 'pkgTwo'])).toContain(
      "NAME = 'PKG_ONE' OR NAME = 'PKGTWO'"
    );
    expect((): void => {
      notify.getPackagesNotifySql(['pkg;drop']);
    }).toThrow('Unsafe SQL identifier');
  });

  it('unsubscribes comma-separated channels and closes connections', async (): Promise<void> => {
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
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(
      oracleConnection as never,
      createLogger(),
      {}
    );

    notify.getNotificationPool().set('a', connectionA as never);
    notify.getNotificationPool().set('b', connectionB as never);

    await notify.unlistenNotify('a, b');

    expect(connectionA.unsubscribe).toHaveBeenCalledWith('a');
    expect(connectionB.unsubscribe).toHaveBeenCalledWith('b');
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledTimes(2);
  });

  it('closes timed-out subscriptions without calling unsubscribe', async (): Promise<void> => {
    const connection = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(
      oracleConnection as never,
      createLogger(),
      {}
    );

    notify.getNotificationPool().set('channel', connection as never);
    await notify.unlistenNotify('channel', true);

    expect(connection.unsubscribe).not.toHaveBeenCalled();
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
  });
});
