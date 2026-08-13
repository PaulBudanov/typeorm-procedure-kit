import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureListBase } from '../../src/core/procedure-list-base.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

describe('ProcedureListBase', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes package maps from database arguments', async (): Promise<void> => {
    const adapter = createAdapterMock({
      generatePackageInfoSql: vi.fn(
        (_packageName: string, _procedureMetadataSql?: string): string =>
          'select args'
      ),
      sortArgumentsAlgorithm: vi.fn(() => ({
        run: [
          {
            argumentName: 'p_id',
            argumentType: 'NUMBER',
            order: 1,
            mode: 'IN' as const,
          },
        ],
      })),
    });
    const executeBase = {
      execute: vi
        .fn<(_sql: string) => Promise<Array<Record<string, unknown>>>>()
        .mockResolvedValue([
          {
            PROCEDURE_NAME: 'RUN',
            ARGUMENT_NAME: 'P_ID',
            ARGUMENT_TYPE: 'NUMBER',
            order: 1,
            mode: 'IN' as const,
          },
        ]),
    };
    const procedureList = new ProcedureListBase(
      createLogger(),
      adapter,
      executeBase as never,
      {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      }
    );

    await procedureList.initPackagesMap();

    expect(procedureList.packagesWithProceduresList.get('pkg')).toEqual({
      run: [
        { argumentName: 'p_id', argumentType: 'NUMBER', order: 1, mode: 'IN' },
      ],
    });
    expect(adapter.generatePackageInfoSql).toHaveBeenCalledWith(
      'pkg',
      undefined
    );
  });

  it('passes custom procedure metadata SQL to the adapter', async (): Promise<void> => {
    const adapter = createAdapterMock({
      generatePackageInfoSql: vi.fn(
        (_packageName: string, procedureMetadataSql?: string): string =>
          procedureMetadataSql ?? 'select args'
      ),
      sortArgumentsAlgorithm: vi.fn(() => ({
        run: [
          {
            argumentName: 'p_id',
            argumentType: 'NUMBER',
            order: 1,
            mode: 'IN' as const,
          },
        ],
      })),
    });
    const executeBase = {
      execute: vi
        .fn<(_sql: string) => Promise<Array<Record<string, unknown>>>>()
        .mockResolvedValue([
          {
            procedure_name: 'run',
            argument_name: 'p_id',
            argument_type: 'NUMBER',
            order: 1,
            mode: 'IN',
          },
        ]),
    };
    const procedureList = new ProcedureListBase(
      createLogger(),
      adapter,
      executeBase as never,
      {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
        procedureMetadataSql:
          'select * from custom_args where package_name = :PACKAGE_NAME',
      }
    );

    await procedureList.initPackagesMap();

    expect(adapter.generatePackageInfoSql).toHaveBeenCalledWith(
      'pkg',
      'select * from custom_args where package_name = :PACKAGE_NAME'
    );
    expect(executeBase.execute).toHaveBeenCalledWith(
      'select * from custom_args where package_name = :PACKAGE_NAME'
    );
  });

  it('decodes and validates raw procedure metadata before adapter sorting', async (): Promise<void> => {
    const sortArgumentsAlgorithm = vi.fn(() => ({ run: [] }));
    const adapter = createAdapterMock({
      generatePackageInfoSql: vi.fn(() => 'select args'),
      sortArgumentsAlgorithm,
    });
    const procedureList = new ProcedureListBase(
      createLogger(),
      adapter,
      {
        execute: vi.fn().mockResolvedValue([
          {
            PROCEDURE_NAME: 'RUN',
            ARGUMENT_NAME: 'P_VALUE',
            ARGUMENT_TYPE: 'VARCHAR2',
            ORDER: '2',
            MODE: 'INOUT',
            SIZE: '4096',
          },
        ]),
      } as never,
      {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      }
    );

    await procedureList.initPackagesMap();

    expect(sortArgumentsAlgorithm).toHaveBeenCalledWith(
      [
        {
          procedureName: 'RUN',
          argumentName: 'P_VALUE',
          argumentType: 'VARCHAR2',
          order: 2,
          mode: 'IN/OUT',
          size: 4096,
        },
      ],
      ['pkg.run'],
      'pkg',
      1
    );
  });

  it.each([
    { MODE: 'SIDEWAYS', ORDER: 1, SIZE: 128 },
    { MODE: 'IN', ORDER: Number.NaN, SIZE: 128 },
    { MODE: 'IN', ORDER: '   ', SIZE: 128 },
    { MODE: 'IN', ORDER: 1, SIZE: 0 },
  ])(
    'rejects malformed procedure metadata %#',
    async (patch): Promise<void> => {
      const procedureList = new ProcedureListBase(
        createLogger(),
        createAdapterMock({
          generatePackageInfoSql: vi.fn(() => 'select args'),
        }),
        {
          execute: vi.fn().mockResolvedValue([
            {
              PROCEDURE_NAME: 'RUN',
              ARGUMENT_NAME: 'P_VALUE',
              ARGUMENT_TYPE: 'VARCHAR2',
              ...patch,
            },
          ]),
        } as never,
        {
          packages: ['pkg'],
          procedureObjectList: { run: 'pkg.run' },
        }
      );

      await expect(procedureList.initPackagesMap()).rejects.toBeInstanceOf(
        ServerError
      );
      await procedureList.destroy();
    }
  );

  it('does nothing when package settings are absent', async (): Promise<void> => {
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock(),
      {} as never
    );

    await expect(procedureList.initPackagesMap()).resolves.toBeUndefined();
  });

  it('schedules only one non-blocking background retry per package', async (): Promise<void> => {
    vi.useFakeTimers();
    const executeBase = {
      execute: vi
        .fn<(_sql: string) => Promise<Array<Record<string, unknown>>>>()
        .mockResolvedValue([]),
    };
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock({
        generatePackageInfoSql: vi.fn(
          (_packageName: string): string => 'select args'
        ),
      }),
      executeBase as never,
      {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      }
    );

    await expect(
      procedureList.fetchProcedureListWithArguments('pkg')
    ).rejects.toBeInstanceOf(ServerError);
    expect(executeBase.execute).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000 * 60 * 5);
    expect(executeBase.execute).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    procedureList.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the previous metadata snapshot when refresh fails', async (): Promise<void> => {
    vi.useFakeTimers();
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock({
        generatePackageInfoSql: vi.fn(
          (_packageName: string): string => 'select args'
        ),
      }),
      {
        execute: vi.fn().mockResolvedValue([]),
      } as never,
      {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      }
    );
    const previousSnapshot = new Map([
      [
        'pkg' as Lowercase<string>,
        {
          run: [
            {
              argumentName: 'p_id',
              argumentType: 'NUMBER',
              order: 1,
              mode: 'IN' as const,
            },
          ],
        },
      ],
    ]);
    procedureList.packagesWithProceduresList = previousSnapshot;

    await expect(
      procedureList.fetchProcedureListWithArguments('pkg')
    ).rejects.toBeInstanceOf(ServerError);

    expect(procedureList.packagesWithProceduresList).toBe(previousSnapshot);
    expect(procedureList.packagesWithProceduresList.get('pkg')).toHaveProperty(
      'run'
    );
    procedureList.destroy();
  });

  it('waits for an in-flight background retry and never publishes after destroy', async (): Promise<void> => {
    vi.useFakeTimers();
    let resolveRetry!: (value: Array<Record<string, unknown>>) => void;
    const retryResult = new Promise<Array<Record<string, unknown>>>(
      (resolve) => {
        resolveRetry = resolve;
      }
    );
    const execute = vi
      .fn<(_sql: string) => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(retryResult);
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock({
        generatePackageInfoSql: vi.fn(() => 'select args'),
        sortArgumentsAlgorithm: vi.fn(() => ({ refreshed: [] })),
      }),
      { execute } as never,
      {
        packages: ['pkg'],
        procedureObjectList: { refreshed: 'pkg.refreshed' },
      }
    );

    await expect(
      procedureList.fetchProcedureListWithArguments('pkg')
    ).rejects.toBeInstanceOf(ServerError);
    await vi.advanceTimersByTimeAsync(1000 * 60 * 5);
    expect(execute).toHaveBeenCalledTimes(2);

    let destroyCompleted = false;
    const destroyPromise = procedureList.destroy().then(() => {
      destroyCompleted = true;
    });
    await Promise.resolve();
    expect(destroyCompleted).toBe(false);

    resolveRetry([
      {
        procedure_name: 'refreshed',
        argument_name: 'p_id',
        argument_type: 'NUMBER',
        order: 1,
        mode: 'IN',
      },
    ]);
    await destroyPromise;

    expect(procedureList.packagesWithProceduresList.size).toBe(0);
    await expect(
      procedureList.fetchProcedureListWithArguments('pkg')
    ).rejects.toThrow('ProcedureListBase is destroyed');
  });
});
