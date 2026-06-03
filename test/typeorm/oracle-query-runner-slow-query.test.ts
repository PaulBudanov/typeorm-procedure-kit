import { describe, expect, it, vi } from 'vitest';

import { OracleQueryRunner } from '../../src/typeorm/driver/oracle/OracleQueryRunner.js';

function createQueryRunner(
  oracleConnection: {
    callTimeout: number;
    execute: ReturnType<typeof vi.fn>;
  },
  options: {
    maxQueryExecutionTime?: number;
    queryTimeoutMs?: number;
  } = { maxQueryExecutionTime: 10 }
): OracleQueryRunner {
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
    options,
    oracle: { OUT_FORMAT_OBJECT: 1 },
    obtainMasterConnection: vi.fn().mockResolvedValue(oracleConnection),
  };
  Object.assign(dataSource, { driver });

  return new OracleQueryRunner(driver as never, 'master');
}

describe('OracleQueryRunner slow-query threshold', (): void => {
  it('does not convert maxQueryExecutionTime into a hard timeout', async (): Promise<void> => {
    const oracleConnection = {
      callTimeout: 25,
      execute: vi.fn(async (): Promise<{ rows: Array<unknown> }> => {
        expect(oracleConnection.callTimeout).toBe(25);
        return { rows: [] };
      }),
    };
    const queryRunner = createQueryRunner(oracleConnection, {
      maxQueryExecutionTime: 100,
    });

    await expect(queryRunner.query('select 1 from dual')).resolves.toEqual([]);
    expect(oracleConnection.callTimeout).toBe(25);
  });

  it('applies queryTimeoutMs as Oracle connection callTimeout', async (): Promise<void> => {
    const oracleConnection = {
      callTimeout: 0,
      execute: vi.fn(async (): Promise<{ rows: Array<unknown> }> => {
        expect(oracleConnection.callTimeout).toBe(250);
        return { rows: [] };
      }),
    };
    const queryRunner = createQueryRunner(oracleConnection, {
      queryTimeoutMs: 250,
    });

    await expect(queryRunner.query('select 1 from dual')).resolves.toEqual([]);
    expect(oracleConnection.callTimeout).toBe(250);
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not apply invalid queryTimeoutMs %s as Oracle connection callTimeout',
    async (queryTimeoutMs): Promise<void> => {
      const oracleConnection = {
        callTimeout: 25,
        execute: vi.fn(async (): Promise<{ rows: Array<unknown> }> => {
          expect(oracleConnection.callTimeout).toBe(25);
          return { rows: [] };
        }),
      };
      const queryRunner = createQueryRunner(oracleConnection, {
        queryTimeoutMs,
      });

      await expect(queryRunner.query('select 1 from dual')).resolves.toEqual(
        []
      );
      expect(oracleConnection.callTimeout).toBe(25);
    }
  );
});
