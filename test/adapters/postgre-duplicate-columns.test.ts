import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import { ExecuteBase } from '../../src/core/execute-base.js';
import { PostgresDriver } from '../../src/typeorm/driver/postgres/PostgresDriver.js';
import { PostgresQueryRunner } from '../../src/typeorm/driver/postgres/PostgresQueryRunner.js';
import { QueryFailedError } from '../../src/typeorm/error/QueryFailedError.js';
import { runInKitCall } from '../../src/utils/kit-call-context.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

import type { ITestLogger } from '../support/helpers.js';
import type { FieldDef } from 'pg';

/**
 * These tests hand the serializer results assembled by node-postgres itself rather than by hand,
 * because the defect lives in how the driver assembles them. Both pieces come from the installed
 * driver:
 *
 * - `pg-protocol` `parseField` turns each RowDescription entry into a `Field` with `name`,
 *   `tableID`, `columnID`, `dataTypeID`, `dataTypeSize`, `dataTypeModifier` and `format`. Two
 *   columns may carry the same `name`; the protocol does not care.
 * - `pg/lib/query.js` passes those to `Result.addFields`, then each DataRow to `Result.parseRow`,
 *   which assigns `row[field.name] = value` column by column. A repeated name therefore leaves one
 *   key, in the first column's position, holding the last column's value. `Result.fields` keeps
 *   both entries.
 */

interface IPgResult {
  readonly fields: Array<FieldDef>;
  readonly rows: Array<unknown>;
  addFields(fieldDescriptions: Array<FieldDef>): void;
  parseRow(rowData: Array<string | null>): unknown;
  addRow(row: unknown): void;
  addCommandComplete(message: { text: string }): void;
}

type TPgResultConstructor = new () => IPgResult;

type TPgFieldConstructor = new (
  name: string,
  tableID: number,
  columnID: number,
  dataTypeID: number,
  dataTypeSize: number,
  dataTypeModifier: number,
  format: 'text' | 'binary'
) => FieldDef;

const requireFromTest = createRequire(import.meta.url);
const pgResultClass = requireFromTest(
  'pg/lib/result.js'
) as TPgResultConstructor;
// pg-protocol is resolved from pg's own location: it is pg's dependency, not this package's.
const requireFromPg = createRequire(requireFromTest.resolve('pg'));
const { Field } = requireFromPg('pg-protocol/dist/messages.js') as {
  Field: TPgFieldConstructor;
};

/** Table OIDs as the server would report them for `orders o JOIN customers c`. */
const ORDERS_TABLE_OID = 16385;
const CUSTOMERS_TABLE_OID = 16392;

function int4Column(name: string, tableID: number, columnID: number): FieldDef {
  return new Field(
    name,
    tableID,
    columnID,
    pgTypes.builtins.INT4,
    4,
    -1,
    'text'
  );
}

function textColumn(name: string, tableID: number, columnID: number): FieldDef {
  return new Field(
    name,
    tableID,
    columnID,
    pgTypes.builtins.TEXT,
    -1,
    -1,
    'text'
  );
}

/**
 * Replays one statement through node-postgres's own `Result`, in the order `Query` drives it:
 * `handleRowDescription` → `addFields`, then `handleDataRow` → `addRow(parseRow(...))` per row.
 * @param fields - the RowDescription entries.
 * @param dataRows - the text-format DataRow values, one array per row.
 * @returns the result object `client.query()` would resolve with.
 */
function receiveResult(
  fields: Array<FieldDef>,
  dataRows: Array<Array<string | null>>
): IPgResult {
  const result = new pgResultClass();
  result.addFields(fields);
  for (const dataRow of dataRows) result.addRow(result.parseRow(dataRow));
  result.addCommandComplete({ text: `SELECT ${dataRows.length}` });
  return result;
}

const lowerCaseStrategy = {
  transformColumnName: (value: string): string => value.toLowerCase(),
  destroy: (): void => undefined,
};

function createSerializer(
  logger: ITestLogger = createLogger()
): PostgreSerializer {
  return new PostgreSerializer(logger, {
    isNeedRegisterDefaultSerializers: false,
    caseStrategy: lowerCaseStrategy,
  });
}

/** `SELECT o.id, c.id FROM orders o JOIN customers c ON ...` */
const JOINED_ID_COLUMNS = [
  int4Column('id', ORDERS_TABLE_OID, 1),
  int4Column('id', CUSTOMERS_TABLE_OID, 1),
];

const JOINED_ID_COLLISION =
  'PostgreSQL result columns "id" and "id" have conflicting transformed name "id"';

/**
 * Renames a result the way it is renamed inside `call()` or `callSqlTransaction()`.
 * @param serializer - the serializer under test.
 * @param result - the result node-postgres assembled.
 * @returns the renamed rows, or the rejection the serializer raised.
 */
async function transformInKitCall(
  serializer: PostgreSerializer,
  result: IPgResult
): Promise<Array<unknown>> {
  return runInKitCall(
    async (): Promise<Array<unknown>> =>
      serializer.transformRows(result.rows, result.fields)
  );
}

describe('PostgreSQL result columns that share one name', (): void => {
  it('is a result in which node-postgres has already dropped a column', (): void => {
    // The precondition, pinned so that a driver change which stops collapsing the row is noticed
    // here instead of silently turning the tests below into tests of nothing.
    const result = receiveResult(JOINED_ID_COLUMNS, [['7', '42']]);

    expect(result.fields.map(({ name, tableID }) => [name, tableID])).toEqual([
      ['id', ORDERS_TABLE_OID],
      ['id', CUSTOMERS_TABLE_OID],
    ]);
    expect(result.rows).toEqual([{ id: 42 }]);
  });

  it('rejects the result inside a kit call instead of returning the surviving value', async (): Promise<void> => {
    const result = receiveResult(JOINED_ID_COLUMNS, [['7', '42']]);

    const failure = await transformInKitCall(createSerializer(), result).then(
      (): unknown => undefined,
      (error: unknown): unknown => error
    );

    expect(failure).toBeInstanceOf(ServerError);
    expect((failure as Error).message).toBe(JOINED_ID_COLLISION);
  });

  it('returns the surviving value outside a kit call and warns once', (): void => {
    const logger = createLogger();
    const result = receiveResult(JOINED_ID_COLUMNS, [['7', '42']]);

    expect(
      createSerializer(logger).transformRows(result.rows, result.fields)
    ).toStrictEqual([{ id: 42 }]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(JOINED_ID_COLLISION);
  });

  it('rejects the result inside a kit call even when it has no rows', async (): Promise<void> => {
    // Like the Oracle check, which runs on the rowset metadata before any row is fetched: whether
    // a query loses a column must not depend on whether it happened to match anything.
    const result = receiveResult(JOINED_ID_COLUMNS, []);

    await expect(
      transformInKitCall(createSerializer(), result)
    ).rejects.toThrow(
      /^PostgreSQL result columns "id" and "id" have conflicting transformed name "id"$/
    );
  });

  it('warns outside a kit call even when the result has no rows', (): void => {
    const logger = createLogger();
    const result = receiveResult(JOINED_ID_COLUMNS, []);

    expect(
      createSerializer(logger).transformRows(result.rows, result.fields)
    ).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(JOINED_ID_COLLISION);
  });

  it('rejects columns that only collide after case conversion inside a kit call', async (): Promise<void> => {
    const result = receiveResult(
      [
        int4Column('ORDER_ID', ORDERS_TABLE_OID, 1),
        int4Column('order_id', CUSTOMERS_TABLE_OID, 2),
      ],
      [['7', '8']]
    );

    expect(result.rows).toEqual([{ ORDER_ID: 7, order_id: 8 }]);
    await expect(
      transformInKitCall(createSerializer(), result)
    ).rejects.toThrow(
      /^PostgreSQL result columns "ORDER_ID" and "order_id" have conflicting transformed name "order_id"$/
    );
  });

  it('keeps the last of the columns that collide after case conversion outside a kit call', (): void => {
    const logger = createLogger();
    const result = receiveResult(
      [
        int4Column('ORDER_ID', ORDERS_TABLE_OID, 1),
        int4Column('order_id', CUSTOMERS_TABLE_OID, 2),
      ],
      [
        ['7', '8'],
        ['9', '10'],
      ]
    );

    expect(
      createSerializer(logger).transformRows(result.rows, result.fields)
    ).toStrictEqual([{ order_id: 8 }, { order_id: 10 }]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'PostgreSQL result columns "ORDER_ID" and "order_id" have conflicting transformed name "order_id"'
    );
  });

  it('renames distinct columns in row description order and keeps every value', async (): Promise<void> => {
    const logger = createLogger();
    const result = receiveResult(
      [
        int4Column('ORDER_ID', ORDERS_TABLE_OID, 1),
        textColumn('STATUS', ORDERS_TABLE_OID, 2),
        int4Column('CUSTOMER_ID', CUSTOMERS_TABLE_OID, 1),
      ],
      [
        ['7', 'ready', '42'],
        ['8', null, '43'],
      ]
    );

    const rows = await transformInKitCall(createSerializer(logger), result);

    expect(rows).toStrictEqual([
      { order_id: 7, status: 'ready', customer_id: 42 },
      { order_id: 8, status: null, customer_id: 43 },
    ]);
    expect(Object.keys(rows[0] as object)).toEqual([
      'order_id',
      'status',
      'customer_id',
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('falls back to the row keys when the runner has no row description', async (): Promise<void> => {
    // PostgresQueryRunner passes `[]` when a result carries no `fields` array. Nothing is left to
    // detect the collapse with then, exactly as the Oracle check is skipped when the driver omits
    // the rowset metadata; renaming carries on from the keys the row does have.
    const result = receiveResult(JOINED_ID_COLUMNS, [['7', '42']]);

    await expect(
      runInKitCall(
        async (): Promise<Array<unknown>> =>
          createSerializer().transformRows(result.rows, [])
      )
    ).resolves.toEqual([{ id: 42 }]);
  });
});

/**
 * Wires a PostgreAdapter to a real PostgresQueryRunner. The driver object carries the real
 * `PostgresDriver` result-handling methods, so the rows and fields reach the serializer along the
 * production path: runner → `driver.transformResultRows` → the adapter's row transformer.
 *
 * `query()` resolves with the given batch result; `stream()` replays the same statement through a
 * real pg-query-stream, whose node-postgres `Result` receives the row description and parses each
 * DataRow, as pg-cursor drives it.
 * @param options - the batch result, the streamed statement, the logger and the case strategy.
 * @returns a factory for runners that share one driver, adapter and serializer.
 */
function createRunnerFactory(options: {
  readonly result?: IPgResult;
  readonly streamed?: {
    readonly fields: Array<FieldDef>;
    readonly dataRows: Array<Array<string | null>>;
  };
  readonly logger?: ITestLogger;
  readonly caseStrategy?: typeof lowerCaseStrategy;
}): () => PostgresQueryRunner {
  const databaseConnection = {
    // Like `pg.Client.query`: a promise for query text, the stream itself for a submittable.
    query: vi.fn((submitted: unknown): unknown => {
      if (typeof submitted === 'string') return Promise.resolve(options.result);
      const { _result: streamResult } = submitted as { _result: IPgResult };
      const { fields = [], dataRows = [] } = options.streamed ?? {};
      streamResult.addFields(fields);
      return Readable.from(
        dataRows.map((dataRow) => streamResult.parseRow(dataRow)),
        { objectMode: true }
      );
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const dataSource = {
    logger: {
      logQuery: vi.fn(),
      logQueryError: vi.fn(),
      logQuerySlow: vi.fn(),
    },
    subscribers: [],
    options: { replication: { master: {} } },
  };
  const driver = Object.assign(
    Object.create(PostgresDriver.prototype) as PostgresDriver,
    {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      options: {},
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
    }
  );
  Object.assign(dataSource, { driver });
  const adapter = new PostgreAdapter(
    dataSource as never,
    options.logger ?? createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: options.caseStrategy ?? lowerCaseStrategy,
    }
  );
  adapter.registerFetchHandlerHook();
  return (): PostgresQueryRunner => new PostgresQueryRunner(driver, 'master');
}

function createQueryRunner(
  result: IPgResult,
  logger: ITestLogger = createLogger()
): PostgresQueryRunner {
  return createRunnerFactory({ result, logger })();
}

/**
 * Collects what a query fails with.
 * @param query - the pending query.
 * @returns the rejection, or undefined when the query resolved.
 */
async function captureRejection(query: Promise<unknown>): Promise<unknown> {
  return query.then(
    (): unknown => undefined,
    (error: unknown): unknown => error
  );
}

describe('PostgreSQL duplicate result columns through the query runner', (): void => {
  it('returns renamed rows for a query whose columns are distinct', async (): Promise<void> => {
    const queryRunner = createQueryRunner(
      receiveResult(
        [
          int4Column('ORDER_ID', ORDERS_TABLE_OID, 1),
          int4Column('CUSTOMER_ID', CUSTOMERS_TABLE_OID, 1),
        ],
        [['7', '42']]
      )
    );

    await expect(
      queryRunner.query(
        'SELECT o.order_id, c.customer_id FROM orders o JOIN customers c ON true'
      )
    ).resolves.toEqual([{ order_id: 7, customer_id: 42 }]);
  });

  it('fails the query whose columns share a name inside a kit call', async (): Promise<void> => {
    const queryRunner = createQueryRunner(
      receiveResult(JOINED_ID_COLUMNS, [['7', '42']])
    );

    const failure = await captureRejection(
      runInKitCall(
        async (): Promise<unknown> =>
          queryRunner.query(
            'SELECT o.id, c.id FROM orders o JOIN customers c ON true'
          )
      )
    );

    expect(failure).toBeInstanceOf(QueryFailedError);
    const { driverError } = failure as QueryFailedError;
    expect(driverError).toBeInstanceOf(ServerError);
    expect(driverError.message).toBe(JOINED_ID_COLLISION);
  });

  it('returns the rows of that query outside a kit call, with one warning', async (): Promise<void> => {
    const logger = createLogger();
    const queryRunner = createQueryRunner(
      receiveResult(JOINED_ID_COLUMNS, [['7', '42']]),
      logger
    );

    await expect(
      queryRunner.query(
        'SELECT o.id, c.id FROM orders o JOIN customers c ON true'
      )
    ).resolves.toStrictEqual([{ id: 42 }]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(JOINED_ID_COLLISION);
  });
});

describe('PostgreSQL streamed result rows', (): void => {
  const ORDER_COLUMNS = [
    int4Column('ORDER_ID', ORDERS_TABLE_OID, 1),
    textColumn('STATUS', ORDERS_TABLE_OID, 2),
    int4Column('CUSTOMER_ID', CUSTOMERS_TABLE_OID, 1),
  ];

  function orderDataRows(count: number): Array<Array<string | null>> {
    return Array.from({ length: count }, (_value, index) => [
      String(index),
      index % 2 === 0 ? 'ready' : null,
      String(index + 1000),
    ]);
  }

  async function streamRows(
    createRunner: () => PostgresQueryRunner
  ): Promise<Array<unknown>> {
    const stream = await createRunner().stream('SELECT ...');
    return stream.toArray();
  }

  it.each([
    ['distinct columns', ORDER_COLUMNS, orderDataRows(5)],
    [
      'columns that share a name, outside a kit call',
      JOINED_ID_COLUMNS,
      [
        ['7', '42'],
        ['8', '43'],
      ],
    ],
  ])(
    'renames %s exactly as the batch path does',
    async (_label, fields, dataRows): Promise<void> => {
      // The stream gets its own copy of the description, so it plans its names itself instead of
      // reusing the plan the batch result left behind.
      const createRunner = createRunnerFactory({
        result: receiveResult(fields, dataRows),
        streamed: { fields: [...fields], dataRows },
      });

      const batchRows = await createRunner().query('SELECT ...');
      const streamedRows = await streamRows(createRunner);

      expect(streamedRows).toStrictEqual(batchRows);
      expect(JSON.stringify(streamedRows)).toBe(JSON.stringify(batchRows));
      expect(streamedRows.map((row) => Object.keys(row as object))).toEqual(
        (batchRows as Array<object>).map((row) => Object.keys(row))
      );
    }
  );

  it('asks the case strategy once per column, not once per streamed row', async (): Promise<void> => {
    const countingStrategy = {
      transformColumnName: vi.fn((value: string): string =>
        value.toLowerCase()
      ),
      destroy: (): void => undefined,
    };
    const createRunner = createRunnerFactory({
      streamed: { fields: ORDER_COLUMNS, dataRows: orderDataRows(1000) },
      caseStrategy: countingStrategy,
    });
    countingStrategy.transformColumnName.mockClear();

    const rows = await streamRows(createRunner);

    expect(rows).toHaveLength(1000);
    expect(rows[999]).toStrictEqual({
      order_id: 999,
      status: null,
      customer_id: 1999,
    });
    expect(countingStrategy.transformColumnName).toHaveBeenCalledTimes(
      ORDER_COLUMNS.length
    );
  });

  it('warns once for a streamed statement whose columns share a name', async (): Promise<void> => {
    const logger = createLogger();
    const createRunner = createRunnerFactory({
      streamed: {
        fields: JOINED_ID_COLUMNS,
        dataRows: Array.from({ length: 1000 }, (_value, index) => [
          String(index),
          String(index + 1000),
        ]),
      },
      logger,
    });

    const rows = await streamRows(createRunner);

    expect(rows).toHaveLength(1000);
    expect(rows[0]).toStrictEqual({ id: 1000 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(JOINED_ID_COLLISION);
  });
});

describe('PostgreSQL duplicate result columns across concurrent calls', (): void => {
  it('keeps a raw query and a kit call in flight beside it apart', async (): Promise<void> => {
    // Both queries return the very same result, so they also share the row description the
    // serializer plans names from: a plan made for the raw query must not be handed to the kit.
    const logger = createLogger();
    const createRunner = createRunnerFactory({
      result: receiveResult(JOINED_ID_COLUMNS, [['7', '42']]),
      logger,
    });
    let openGate: () => void = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let isKitQueryWaiting = false;
    const executeBase = new ExecuteBase(
      {
        getEntityManager: vi.fn().mockResolvedValue({}),
        releaseEntityManager: vi.fn().mockResolvedValue(undefined),
      } as never,
      createAdapterMock({
        execute: vi
          .fn()
          .mockImplementation(async (sql: string): Promise<unknown> => {
            isKitQueryWaiting = true;
            await gate;
            return createRunner().query(sql);
          }),
      }),
      createLogger()
    );

    const kitCall = captureRejection(
      executeBase.execute('SELECT o.id, c.id FROM orders o JOIN customers c')
    );
    await vi.waitFor((): void => {
      expect(isKitQueryWaiting).toBe(true);
    });
    const rawRows = await createRunner().query(
      'SELECT o.id, c.id FROM orders o JOIN customers c'
    );
    openGate();
    const kitFailure = await kitCall;

    expect(rawRows).toStrictEqual([{ id: 42 }]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(JOINED_ID_COLLISION);
    expect(kitFailure).toBeInstanceOf(ServerError);
    expect((kitFailure as Error).message).toContain(JOINED_ID_COLLISION);
  });
});
