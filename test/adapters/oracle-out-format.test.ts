import { Readable } from 'stream';

import oracledb from 'oracledb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { OracleQueryRunner } from '../../src/typeorm/driver/oracle/OracleQueryRunner.js';
import { createLogger } from '../support/helpers.js';

const ROW = { ID: 1, NAME: 'first' };

/**
 * Picks the row shape the way node-oracledb does: an `outFormat` passed with
 * the execution wins, and only an omitted one falls back to the global
 * `oracledb.outFormat` (`Connection._addDefaultsToExecOpts` and
 * `Settings.addToOptions` in node-oracledb 7).
 */
function shapeRows(
  executionOptions: oracledb.ExecuteOptions
): Array<Record<string, unknown> | Array<unknown>> {
  const outFormat = executionOptions.outFormat ?? oracledb.outFormat;
  return outFormat === oracledb.OUT_FORMAT_OBJECT
    ? [{ ...ROW }]
    : [Object.values(ROW)];
}

/**
 * Builds an `OracleQueryRunner` of the bundled TypeORM driver over a stand-in
 * node-oracledb connection, with the real `oracledb` module as the driver's
 * `oracle` library, as `OracleDriver.loadDependencies()` sets it.
 */
function createQueryRunner(): {
  queryRunner: OracleQueryRunner;
  execute: ReturnType<typeof vi.fn>;
  queryStream: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(
    (
      _query: string,
      _parameters: unknown,
      executionOptions: oracledb.ExecuteOptions
    ): Promise<{ rows: Array<unknown> }> =>
      Promise.resolve({ rows: shapeRows(executionOptions) })
  );
  const queryStream = vi.fn(
    (
      _query: string,
      _parameters: Array<unknown>,
      executionOptions: oracledb.ExecuteOptions
    ): Readable => Readable.from(shapeRows(executionOptions))
  );
  const oracleConnection = { callTimeout: 0, execute, queryStream };
  const dataSource = {
    logger: {
      logQuery: vi.fn(),
      logQueryError: vi.fn(),
      logQuerySlow: vi.fn(),
    },
    subscribers: [],
  };
  const driver = {
    connection: dataSource,
    options: {},
    oracle: oracledb,
    getFetchTypeHandler: vi.fn().mockReturnValue(undefined),
    obtainMasterConnection: vi.fn().mockResolvedValue(oracleConnection),
  };
  Object.assign(dataSource, { driver });

  return {
    queryRunner: new OracleQueryRunner(driver as never, 'master'),
    execute,
    queryStream,
  };
}

describe('Oracle outFormat', (): void => {
  let globalOutFormat: number;

  beforeEach((): void => {
    globalOutFormat = oracledb.outFormat;
    // node-oracledb's own default, so a run that relied on it would see arrays.
    oracledb.outFormat = oracledb.OUT_FORMAT_ARRAY;
  });

  afterEach((): void => {
    oracledb.outFormat = globalOutFormat;
  });

  it('leaves the global oracledb.outFormat untouched when an OracleAdapter is created', (): void => {
    const adapter = new OracleAdapter(
      {
        options: { replication: { master: {} } },
        driver: { setFetchTypeHandler: vi.fn() },
      } as never,
      createLogger(),
      {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy: {
          transformColumnName: (value: string): string => value.toLowerCase(),
        },
      }
    );

    expect(adapter).toBeInstanceOf(OracleAdapter);
    expect(oracledb.outFormat).toBe(oracledb.OUT_FORMAT_ARRAY);
  });

  it('passes outFormat OUT_FORMAT_OBJECT with each query run through OracleQueryRunner', async (): Promise<void> => {
    const { queryRunner, execute } = createQueryRunner();

    await expect(queryRunner.query('select id, name from t')).resolves.toEqual([
      { ID: 1, NAME: 'first' },
    ]);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      'select id, name from t',
      {},
      expect.objectContaining({ outFormat: oracledb.OUT_FORMAT_OBJECT })
    );
    expect(oracledb.outFormat).toBe(oracledb.OUT_FORMAT_ARRAY);
  });

  it('passes outFormat OUT_FORMAT_OBJECT with each stream opened through OracleQueryRunner', async (): Promise<void> => {
    const { queryRunner, queryStream } = createQueryRunner();

    const stream = await queryRunner.stream('select id, name from t');
    const rows: Array<unknown> = [];
    for await (const row of stream) rows.push(row);

    expect(rows).toEqual([{ ID: 1, NAME: 'first' }]);
    expect(queryStream).toHaveBeenCalledOnce();
    expect(queryStream).toHaveBeenCalledWith(
      'select id, name from t',
      [],
      expect.objectContaining({ outFormat: oracledb.OUT_FORMAT_OBJECT })
    );
    expect(oracledb.outFormat).toBe(oracledb.OUT_FORMAT_ARRAY);
  });
});
