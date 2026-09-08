import { Readable } from 'stream';

import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { OracleQueryRunner } from '../../src/typeorm/driver/oracle/OracleQueryRunner.js';
import { createLogger } from '../support/helpers.js';

describe('OracleQueryRunner stream fetch handler', (): void => {
  it('passes the instance handler registered by OracleAdapter to queryStream', async (): Promise<void> => {
    type TFetchTypeHandler = NonNullable<
      oracledb.ExecuteOptions['fetchTypeHandler']
    >;

    const sourceDate = new Date('2026-07-16T09:30:45.123Z');
    let registeredFetchTypeHandler: TFetchTypeHandler | undefined;
    const queryStream = vi.fn(
      (
        _query: string,
        _parameters: Array<unknown>,
        executionOptions: oracledb.ExecuteOptions
      ): Readable => {
        const metadata = {
          name: 'CREATED_AT',
          dbType: oracledb.DB_TYPE_DATE,
        } as oracledb.Metadata<unknown>;
        const fetchType = executionOptions.fetchTypeHandler?.(metadata);
        const value: unknown = fetchType?.converter
          ? (fetchType.converter(sourceDate) as unknown)
          : sourceDate;
        return Readable.from([{ [metadata.name]: value }]);
      }
    );
    const oracleConnection = {
      callTimeout: 0,
      queryStream,
    };
    const dataSource = {
      options: { replication: { master: {} } },
      logger: {
        logQuery: vi.fn(),
        logQueryError: vi.fn(),
      },
      subscribers: [],
    };
    const driver = {
      connection: dataSource,
      options: {},
      oracle: { OUT_FORMAT_OBJECT: oracledb.OUT_FORMAT_OBJECT },
      setFetchTypeHandler: vi.fn((handler: TFetchTypeHandler): void => {
        registeredFetchTypeHandler = handler;
      }),
      getFetchTypeHandler: vi.fn(() => registeredFetchTypeHandler),
      obtainMasterConnection: vi.fn().mockResolvedValue(oracleConnection),
    };
    Object.assign(dataSource, { driver });

    const adapter = new OracleAdapter(dataSource as never, createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string => value.toLowerCase(),
      },
    });
    adapter.setSerializer({
      serializerType: 'DATE',
      strategy: ({ value }): string =>
        `serialized:${(value as Date).toISOString()}`,
    });
    adapter.registerFetchHandlerHook();

    const queryRunner = new OracleQueryRunner(driver as never, 'master');
    const stream = await queryRunner.stream('select created_at from events');
    const rows: Array<unknown> = [];
    for await (const row of stream) rows.push(row);

    expect(driver.getFetchTypeHandler).toHaveBeenCalledOnce();
    expect(queryStream).toHaveBeenCalledWith(
      'select created_at from events',
      [],
      expect.objectContaining({
        fetchTypeHandler: registeredFetchTypeHandler,
      })
    );
    expect(rows).toEqual([
      {
        created_at: 'serialized:2026-07-16T09:30:45.123Z',
      },
    ]);
  });
});
