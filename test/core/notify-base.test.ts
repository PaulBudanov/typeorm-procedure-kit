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

    await notifyBase.packageNotifyCallback({ event: 'CREATE', object: 'PKG' });
    await notifyBase.packageNotifyCallback([
      { name: 'PKG' },
      { name: 'OTHER' },
    ] as never);

    expect(fetchProcedureListWithArguments).toHaveBeenCalledWith('pkg');
    expect(fetchProcedureListWithArguments).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent refreshes for the same package', async (): Promise<void> => {
    let resolveRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchProcedureListWithArguments = vi
      .fn<(_packageName: Lowercase<string>) => Promise<void>>()
      .mockReturnValue(refresh);
    const notifyBase = new NotifyBase(
      createAdapterMock(),
      { fetchProcedureListWithArguments } as never,
      createLogger(),
      {
        packages: ['pkg'],
        procedureObjectList: {},
      }
    );

    const first = notifyBase.packageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });
    const second = notifyBase.packageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });
    await Promise.resolve();

    expect(fetchProcedureListWithArguments).toHaveBeenCalledOnce();
    resolveRefresh();
    await Promise.all([first, second]);
  });

  it('reruns a package refresh when an event arrives during an in-flight refresh', async (): Promise<void> => {
    const refreshResolvers: Array<() => void> = [];
    const fetchProcedureListWithArguments = vi
      .fn<(_packageName: Lowercase<string>) => Promise<void>>()
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            refreshResolvers.push(resolve);
          })
      );
    const notifyBase = new NotifyBase(
      createAdapterMock(),
      { fetchProcedureListWithArguments } as never,
      createLogger(),
      {
        packages: ['pkg'],
        procedureObjectList: {},
      }
    );

    const first = notifyBase.packageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });
    await vi.waitFor(() => {
      expect(fetchProcedureListWithArguments).toHaveBeenCalledOnce();
    });
    const second = notifyBase.packageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });

    refreshResolvers[0]!();
    await vi.waitFor(() => {
      expect(fetchProcedureListWithArguments).toHaveBeenCalledTimes(2);
    });
    refreshResolvers[1]!();
    await Promise.all([first, second]);
  });
});
