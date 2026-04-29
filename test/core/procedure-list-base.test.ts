import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureListBase } from '../../src/core/procedure-list-base.js';
import { AsyncUtils } from '../../src/utils/async-utils.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

describe('ProcedureListBase', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('initializes package maps from database arguments', async (): Promise<void> => {
    const adapter = createAdapterMock({
      generatePackageInfoSql: vi.fn(
        (_packageName: string): string => 'select args'
      ),
      sortArgumentsAlgorithm: vi.fn(() => ({
        run: [
          {
            argumentName: 'p_id',
            argumentType: 'NUMBER',
            order: 1,
            mode: 'IN',
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
      }
    );

    await procedureList.initPackagesMap();

    expect(procedureList.packagesWithProceduresList.get('pkg')).toEqual({
      run: [
        { argumentName: 'p_id', argumentType: 'NUMBER', order: 1, mode: 'IN' },
      ],
    });
    expect(adapter.generatePackageInfoSql).toHaveBeenCalledWith('pkg');
  });

  it('does nothing when package settings are absent', async (): Promise<void> => {
    const procedureList = new ProcedureListBase(
      createLogger(),
      createAdapterMock(),
      {} as never
    );

    await expect(procedureList.initPackagesMap()).resolves.toBeUndefined();
  });

  it('retries once and then wraps fetch errors', async (): Promise<void> => {
    vi.spyOn(AsyncUtils, 'delay').mockResolvedValue(undefined);
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
    expect(AsyncUtils.delay).toHaveBeenCalledOnce();
    expect(executeBase.execute).toHaveBeenCalledTimes(2);
  });
});
