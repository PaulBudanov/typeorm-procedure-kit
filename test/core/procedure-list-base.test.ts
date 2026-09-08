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
            SPECIFIC_NAME: 'run_123',
            OWNER: 'APP',
            SUBPROGRAM_ID: '2',
            OVERLOAD: '1',
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
          specificName: 'run_123',
          owner: 'APP',
          subprogramId: 2,
          overload: '1',
        },
      ],
      ['pkg.run'],
      'pkg',
      1
    );
  });

  it('publishes validated structured metadata from the vendor preparation hook', async (): Promise<void> => {
    const sortArgumentsAlgorithm = vi.fn(() => ({ run: [] }));
    const prepareProcedureMetadataRows = vi.fn(() => [
      {
        procedureName: 'RUN',
        argumentName: 'P_ADDRESS',
        argumentType: 'ADDRESS_TYPE',
        order: 1,
        mode: 'IN/OUT',
        structuredType: {
          kind: 'postgres-composite',
          schema: 'app',
          typeName: 'address_type',
          typeOid: '1234',
          fields: [
            { name: 'ZIP', argumentType: 'int4', order: '2' },
            { name: 'CITY', argumentType: 'text', order: 1 },
          ],
        },
      },
    ]);
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock({
        generatePackageInfoSql: vi.fn(() => 'select args'),
        prepareProcedureMetadataRows,
        sortArgumentsAlgorithm,
      }),
      {
        execute: vi.fn().mockResolvedValue([
          {
            PROCEDURE_NAME: 'RUN',
            ARGUMENT_NAME: 'P_ADDRESS',
            ARGUMENT_TYPE: 'record',
            ORDER: 1,
            MODE: 'INOUT',
          },
        ]),
      } as never,
      {
        packages: ['app'],
        procedureObjectList: { run: 'app.run' },
      }
    );

    await procedureList.initPackagesMap();

    expect(prepareProcedureMetadataRows).toHaveBeenCalledOnce();
    expect(sortArgumentsAlgorithm).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          structuredType: {
            kind: 'postgres-composite',
            schema: 'app',
            typeName: 'address_type',
            typeOid: 1234,
            fields: [
              { name: 'CITY', argumentType: 'text', order: 1 },
              { name: 'ZIP', argumentType: 'int4', order: 2 },
            ],
          },
        }),
      ],
      ['app.run'],
      'app',
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

    void procedureList.destroy();
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
    void procedureList.destroy();
  });

  it('coalesces concurrent refreshes and performs one final rerun', async (): Promise<void> => {
    const resolvers: Array<(value: Array<Record<string, unknown>>) => void> =
      [];
    const execute = vi.fn(
      () =>
        new Promise<Array<Record<string, unknown>>>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock({
        generatePackageInfoSql: vi.fn(() => 'select args'),
        sortArgumentsAlgorithm: vi.fn((argumentsList) => ({
          [argumentsList[0]!.procedureName.toLowerCase()]: [],
        })),
      }),
      { execute } as never,
      {
        packages: ['pkg'],
        procedureObjectList: { latest: 'pkg.latest' },
      }
    );

    const first = procedureList.fetchProcedureListWithArguments('pkg');
    const concurrent = procedureList.fetchProcedureListWithArguments('pkg');
    expect(execute).toHaveBeenCalledOnce();

    resolvers[0]!([
      {
        procedure_name: 'old',
        argument_name: 'p_id',
        argument_type: 'NUMBER',
        order: 1,
        mode: 'IN',
      },
    ]);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    resolvers[1]!([
      {
        procedure_name: 'latest',
        argument_name: 'p_id',
        argument_type: 'NUMBER',
        order: 1,
        mode: 'IN',
      },
    ]);

    await expect(first).resolves.toBeUndefined();
    await expect(concurrent).resolves.toBeUndefined();
    expect(procedureList.packagesWithProceduresList.get('pkg')).toEqual({
      latest: [],
    });
  });

  it('rejects oversized procedure metadata before decoding or sorting it', async (): Promise<void> => {
    const sortArgumentsAlgorithm = vi.fn();
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock({
        generatePackageInfoSql: vi.fn(() => 'select args'),
        sortArgumentsAlgorithm,
      }),
      {
        execute: vi
          .fn()
          .mockResolvedValue([{ invalid: true }, { invalid: true }]),
      } as never,
      {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      },
      1
    );

    await expect(
      procedureList.fetchProcedureListWithArguments('pkg')
    ).rejects.toThrow('resourceLimits.maxMetadataRows (1)');
    expect(sortArgumentsAlgorithm).not.toHaveBeenCalled();
    void procedureList.destroy();
  });

  it('counts structured fields toward the metadata resource limit', async (): Promise<void> => {
    const sortArgumentsAlgorithm = vi.fn();
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock({
        generatePackageInfoSql: vi.fn(() => 'select args'),
        prepareProcedureMetadataRows: vi.fn(() => [
          {
            procedureName: 'RUN',
            argumentName: 'P_VALUE',
            argumentType: 'VALUE_TYPE',
            order: 1,
            mode: 'IN',
            structuredType: {
              kind: 'postgres-composite',
              schema: 'app',
              typeName: 'value_type',
              fields: [
                { name: 'FIRST', argumentType: 'text', order: 1 },
                { name: 'SECOND', argumentType: 'text', order: 2 },
              ],
            },
          },
        ]),
        sortArgumentsAlgorithm,
      }),
      {
        execute: vi.fn().mockResolvedValue([
          {
            PROCEDURE_NAME: 'RUN',
            ARGUMENT_NAME: 'P_VALUE',
            ARGUMENT_TYPE: 'record',
            ORDER: 1,
            MODE: 'IN',
          },
        ]),
      } as never,
      {
        packages: ['app'],
        procedureObjectList: { run: 'app.run' },
      },
      2
    );

    await expect(procedureList.initPackagesMap()).rejects.toThrow(
      'resourceLimits.maxMetadataRows (2)'
    );
    expect(sortArgumentsAlgorithm).not.toHaveBeenCalled();
    await procedureList.destroy();
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

    let isDestroyCompleted = false;
    const destroyPromise = procedureList.destroy().then(() => {
      isDestroyCompleted = true;
    });
    await Promise.resolve();
    expect(isDestroyCompleted).toBe(false);

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
