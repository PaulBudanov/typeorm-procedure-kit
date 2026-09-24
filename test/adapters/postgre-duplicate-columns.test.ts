import { createRequire } from 'node:module';

import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import { PostgresDriver } from '../../src/typeorm/driver/postgres/PostgresDriver.js';
import { PostgresQueryRunner } from '../../src/typeorm/driver/postgres/PostgresQueryRunner.js';
import { QueryFailedError } from '../../src/typeorm/error/QueryFailedError.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

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

function createSerializer(): PostgreSerializer {
  return new PostgreSerializer(createLogger(), {
    isNeedRegisterDefaultSerializers: false,
    caseStrategy: lowerCaseStrategy,
  });
}

/** `SELECT o.id, c.id FROM orders o JOIN customers c ON ...` */
const JOINED_ID_COLUMNS = [
  int4Column('id', ORDERS_TABLE_OID, 1),
  int4Column('id', CUSTOMERS_TABLE_OID, 1),
];

/**
 * Runs an action once and returns what it threw.
 * @param action - the call under test.
 * @returns the thrown value, or undefined when the call returned normally.
 */
function captureThrown(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
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

  it('rejects the result instead of returning the surviving value', (): void => {
    const result = receiveResult(JOINED_ID_COLUMNS, [['7', '42']]);

    const thrown = captureThrown((): void => {
      createSerializer().transformRows(result.rows, result.fields);
    });

    expect(thrown).toBeInstanceOf(ServerError);
    expect((thrown as Error).message).toBe(
      'PostgreSQL result columns "id" and "id" have conflicting transformed name "id"'
    );
  });

  it('rejects the result even when it has no rows', (): void => {
    // Like the Oracle check, which runs on the rowset metadata before any row is fetched: whether
    // a query loses a column must not depend on whether it happened to match anything.
    const result = receiveResult(JOINED_ID_COLUMNS, []);

    expect(() =>
      createSerializer().transformRows(result.rows, result.fields)
    ).toThrow(
      /^PostgreSQL result columns "id" and "id" have conflicting transformed name "id"$/
    );
  });

  it('keeps rejecting columns that only collide after case conversion', (): void => {
    const result = receiveResult(
      [
        int4Column('ORDER_ID', ORDERS_TABLE_OID, 1),
        int4Column('order_id', CUSTOMERS_TABLE_OID, 2),
      ],
      [['7', '8']]
    );

    expect(result.rows).toEqual([{ ORDER_ID: 7, order_id: 8 }]);
    expect(() =>
      createSerializer().transformRows(result.rows, result.fields)
    ).toThrow(
      /^PostgreSQL result columns "ORDER_ID" and "order_id" have conflicting transformed name "order_id"$/
    );
  });

  it('renames distinct columns in row description order and keeps every value', (): void => {
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

    const rows = createSerializer().transformRows(result.rows, result.fields);

    expect(rows).toStrictEqual([
      { order_id: 7, status: 'ready', customer_id: 42 },
      { order_id: 8, status: null, customer_id: 43 },
    ]);
    expect(Object.keys(rows[0] as object)).toEqual([
      'order_id',
      'status',
      'customer_id',
    ]);
  });

  it('falls back to the row keys when the runner has no row description', (): void => {
    // PostgresQueryRunner passes `[]` when a result carries no `fields` array. Nothing is left to
    // detect the collapse with then, exactly as the Oracle check is skipped when the driver omits
    // the rowset metadata; renaming carries on from the keys the row does have.
    const result = receiveResult(JOINED_ID_COLUMNS, [['7', '42']]);

    expect(createSerializer().transformRows(result.rows, [])).toEqual([
      { id: 42 },
    ]);
  });
});

describe('PostgreSQL duplicate result columns through the query runner', (): void => {
  /**
   * Wires a PostgreAdapter to a real PostgresQueryRunner. The driver object carries the real
   * `PostgresDriver` result-handling methods, so the rows and fields reach the serializer along
   * the production path: runner → `driver.transformResultRows` → the adapter's row transformer.
   * @param result - what the pooled client's `query()` resolves with.
   * @returns the runner.
   */
  function createQueryRunner(result: IPgResult): PostgresQueryRunner {
    const databaseConnection = {
      query: vi.fn(async (): Promise<IPgResult> => result),
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
    const adapter = new PostgreAdapter(dataSource as never, createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: lowerCaseStrategy,
    });
    adapter.registerFetchHandlerHook();
    return new PostgresQueryRunner(driver, 'master');
  }

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

  it('fails the query whose columns share a name', async (): Promise<void> => {
    const queryRunner = createQueryRunner(
      receiveResult(JOINED_ID_COLUMNS, [['7', '42']])
    );

    const failure = await queryRunner
      .query('SELECT o.id, c.id FROM orders o JOIN customers c ON true')
      .then(
        (): unknown => undefined,
        (error: unknown): unknown => error
      );

    expect(failure).toBeInstanceOf(QueryFailedError);
    const { driverError } = failure as QueryFailedError;
    expect(driverError).toBeInstanceOf(ServerError);
    expect(driverError.message).toBe(
      'PostgreSQL result columns "id" and "id" have conflicting transformed name "id"'
    );
  });
});
