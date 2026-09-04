import { describe, expect, it, vi } from 'vitest';

import { NotifyBase } from '../../src/core/notify-base.js';
import { ProcedureListBase } from '../../src/core/procedure-list-base.js';
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

  it('accepts case-insensitive Oracle field names and ignores malformed rows', async (): Promise<void> => {
    const fetchProcedureListWithArguments = vi
      .fn()
      .mockResolvedValue(undefined);
    const logger = createLogger();
    const notifyBase = new NotifyBase(
      createAdapterMock(),
      { fetchProcedureListWithArguments } as never,
      logger,
      {
        packages: ['PKG' as Lowercase<string>],
        procedureObjectList: {},
      }
    );

    await notifyBase.packageNotifyCallback([
      { NAME: 'PKG' },
      { name: 42 },
    ] as never);

    expect(fetchProcedureListWithArguments).toHaveBeenCalledOnce();
    expect(fetchProcedureListWithArguments).toHaveBeenCalledWith('pkg');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('without a string NAME field')
    );
  });

  it('schedules notification refreshes without awaiting database metadata work', async (): Promise<void> => {
    let resolveRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchProcedureListWithArguments = vi.fn().mockReturnValue(refresh);
    const notifyBase = new NotifyBase(
      createAdapterMock(),
      { fetchProcedureListWithArguments } as never,
      createLogger(),
      {
        packages: ['pkg'],
        procedureObjectList: {},
      }
    );

    const result = notifyBase.schedulePackageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });

    expect(result).toBeUndefined();
    await vi.waitFor(() => {
      expect(fetchProcedureListWithArguments).toHaveBeenCalledOnce();
    });
    resolveRefresh();
    await vi.waitFor(() => {
      expect(fetchProcedureListWithArguments).toHaveBeenCalledOnce();
    });
  });

  it('delegates every concurrent event to ProcedureListBase for coalescing', async (): Promise<void> => {
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

    expect(fetchProcedureListWithArguments).toHaveBeenCalledTimes(2);
    resolveRefresh();
    await Promise.all([first, second]);
  });

  it('lets ProcedureListBase recover a failed refresh when a rerun was requested', async (): Promise<void> => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (rows: Array<Record<string, unknown>>) => void;
    const execute = vi
      .fn<() => Promise<Array<Record<string, unknown>>>>()
      .mockReturnValueOnce(
        new Promise<Array<Record<string, unknown>>>((_, reject) => {
          rejectFirst = reject;
        })
      )
      .mockReturnValueOnce(
        new Promise<Array<Record<string, unknown>>>((resolve) => {
          resolveSecond = resolve;
        })
      );
    const logger = createLogger();
    const adapter = createAdapterMock({
      generatePackageInfoSql: vi.fn(() => 'select args'),
      sortArgumentsAlgorithm: vi.fn(() => ({ run: [] })),
    });
    const procedureList = new ProcedureListBase(
      logger,
      adapter,
      { execute } as never,
      {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      }
    );
    const notifyBase = new NotifyBase(adapter, procedureList, logger, {
      packages: ['pkg'],
      procedureObjectList: { run: 'pkg.run' },
    });

    const first = notifyBase.packageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledOnce();
    });
    const second = notifyBase.packageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });

    rejectFirst(new Error('metadata unavailable'));
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });
    resolveSecond([
      {
        procedure_name: 'run',
        argument_name: 'p_id',
        argument_type: 'NUMBER',
        order: 1,
        mode: 'IN',
      },
    ]);
    await Promise.all([first, second]);
    expect(procedureList.packagesWithProceduresList.get('pkg')).toEqual({
      run: [],
    });
    await notifyBase.destroy();
    await procedureList.destroy();
  });

  it('logs failed scheduled refreshes without an unhandled rejection', async (): Promise<void> => {
    const logger = createLogger();
    const notifyBase = new NotifyBase(
      createAdapterMock(),
      {
        fetchProcedureListWithArguments: vi
          .fn()
          .mockRejectedValue(new Error('refresh failed')),
      } as never,
      logger,
      {
        packages: ['pkg'],
        procedureObjectList: {},
      }
    );

    notifyBase.schedulePackageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to process package notification: refresh failed',
        expect.any(String)
      );
    });
  });

  it('waits for an active refresh during destroy and rejects later work', async (): Promise<void> => {
    let resolveRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchProcedureListWithArguments = vi.fn().mockReturnValue(refresh);
    const destroyNotifications = vi.fn().mockResolvedValue(undefined);
    const notifyBase = new NotifyBase(
      createAdapterMock({ destroyNotifications }),
      { fetchProcedureListWithArguments } as never,
      createLogger(),
      {
        packages: ['pkg'],
        procedureObjectList: {},
      }
    );
    notifyBase.schedulePackageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });
    await vi.waitFor(() => {
      expect(fetchProcedureListWithArguments).toHaveBeenCalledOnce();
    });

    const destroy = notifyBase.destroy();
    notifyBase.schedulePackageNotifyCallback({
      event: 'CREATE',
      object: 'PKG',
    });
    await Promise.resolve();

    expect(fetchProcedureListWithArguments).toHaveBeenCalledOnce();
    expect(destroyNotifications).not.toHaveBeenCalled();
    resolveRefresh();
    await destroy;
    expect(destroyNotifications).toHaveBeenCalledOnce();
  });
});
