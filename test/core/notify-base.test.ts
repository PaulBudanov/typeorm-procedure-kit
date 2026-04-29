import { describe, expect, it, vi } from 'vitest';

import { NotifyBase } from '../../src/core/notify-base.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

describe('NotifyBase', (): void => {
  it('delegates notification lifecycle to the adapter', async (): Promise<void> => {
    const adapter = createAdapterMock({
      listenNotify: vi.fn().mockResolvedValue('channel'),
      unlistenNotify: vi.fn().mockResolvedValue(undefined),
      destroyNotifications: vi.fn().mockResolvedValue(undefined),
      getNotificationPool: vi.fn(
        (): Map<string, unknown> => new Map([['a', {}]])
      ),
    });
    const notifyBase = new NotifyBase(
      adapter,
      { fetchProcedureListWithArguments: vi.fn() } as never,
      createLogger()
    );
    const callback = vi.fn();

    await expect(
      notifyBase.createNotification({
        sql: 'LISTEN channel',
        notifyCallback: callback,
      })
    ).resolves.toBe('channel');
    await notifyBase.unlistenNotification('channel');
    expect(notifyBase.getNotificationPool().has('a')).toBe(true);
    await notifyBase.destroy();

    expect(adapter.listenNotify).toHaveBeenCalledWith(
      'LISTEN channel',
      callback,
      undefined
    );
    expect(adapter.unlistenNotify).toHaveBeenCalledWith('channel');
    expect(adapter.destroyNotifications).toHaveBeenCalledOnce();
  });

  it('refreshes configured packages from notification payloads', async (): Promise<void> => {
    const fetchProcedureListWithArguments = vi
      .fn<(_packageName: Lowercase<string>) => Promise<void>>()
      .mockResolvedValue(undefined);
    const notifyBase = new NotifyBase(
      createAdapterMock(),
      { fetchProcedureListWithArguments } as never,
      createLogger(),
      {
        packages: ['pkg'],
        procedureObjectList: {},
      }
    );

    notifyBase.packageNotifyCallback({ event: 'CREATE', object: 'PKG' });
    notifyBase.packageNotifyCallback([
      { name: 'PKG' },
      { name: 'OTHER' },
    ] as never);
    await Promise.resolve();

    expect(fetchProcedureListWithArguments).toHaveBeenCalledWith('pkg');
    expect(fetchProcedureListWithArguments).toHaveBeenCalledTimes(2);
  });
});
