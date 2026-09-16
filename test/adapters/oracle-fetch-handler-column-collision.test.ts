import oracledb from 'oracledb';
import { describe, expect, it } from 'vitest';

import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { ServerError } from '../../src/utils/server-error.js';
import { StringUtilities } from '../../src/utils/string-utilities.js';
import { createLogger } from '../support/helpers.js';

const caseStrategy = {
  transformColumnName: (value: string): string =>
    StringUtilities.toCamelCase(value),
  destroy: (): void => undefined,
};

function createSerializer(): OracleSerializer {
  return new OracleSerializer(createLogger(), {
    isNeedRegisterDefaultSerializers: false,
    caseStrategy,
  });
}

function createRowset(
  columns: Array<{ name: string; dbType?: oracledb.DbType }>
): Array<oracledb.Metadata<unknown>> {
  return columns.map(({ name, dbType }) => ({
    name,
    dbType: dbType ?? oracledb.DB_TYPE_VARCHAR,
  }));
}

/** Drives the handler exactly as node-oracledb drives it: once per column. */
function runRowset(
  serializer: OracleSerializer,
  rowset: Array<oracledb.Metadata<unknown>>
): Array<string> {
  const handler = serializer.createFetchTypeHandler();
  for (const column of rowset) handler(column, rowset);
  return rowset.map(({ name }) => name);
}

/** Drives every rowset through one handler, as one registered adapter does. */
function runRowsetsOnSharedHandler(
  serializer: OracleSerializer,
  rowsets: Array<Array<oracledb.Metadata<unknown>>>
): Array<Array<string>> {
  const handler = serializer.createFetchTypeHandler();
  return rowsets.map((rowset) => {
    for (const column of rowset) handler(column, rowset);
    return rowset.map(({ name }) => name);
  });
}

describe('Oracle fetch handler column name collisions', (): void => {
  it('rejects two distinct columns that transform to the same name', (): void => {
    const serializer = createSerializer();
    const rowset = createRowset([{ name: 'ORDER_ID' }, { name: 'order id' }]);

    expect(() => runRowset(serializer, rowset)).toThrow(ServerError);
    expect(() => runRowset(createSerializer(), rowset)).toThrow(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });

  it('rejects a collision produced by the case strategy itself', (): void => {
    expect(() =>
      runRowset(
        createSerializer(),
        createRowset([{ name: 'COL_2' }, { name: 'col2' }])
      )
    ).toThrow(
      'Oracle result columns "COL_2" and "col2" have conflicting transformed name "col2"'
    );
  });

  it('accepts two separate queries that share a column name', (): void => {
    const serializer = createSerializer();

    const names = runRowsetsOnSharedHandler(serializer, [
      createRowset([{ name: 'ORDER_ID' }, { name: 'CUSTOMER_NAME' }]),
      createRowset([{ name: 'ORDER_ID' }, { name: 'TOTAL_SUM' }]),
      createRowset([{ name: 'ORDER_ID' }]),
    ]);

    expect(names).toEqual([
      ['orderId', 'customerName'],
      ['orderId', 'totalSum'],
      ['orderId'],
    ]);
  });

  it('accepts the same query executed repeatedly on one handler', (): void => {
    const serializer = createSerializer();
    const handler = serializer.createFetchTypeHandler();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rowset = createRowset([{ name: 'ORDER_ID' }, { name: 'AMOUNT' }]);
      for (const column of rowset) handler(column, rowset);
      expect(rowset.map(({ name }) => name)).toEqual(['orderId', 'amount']);
    }
  });

  it('accepts a single column', (): void => {
    expect(
      runRowset(createSerializer(), createRowset([{ name: 'ORDER_ID' }]))
    ).toEqual(['orderId']);
  });

  it('leaves cursor columns unrenamed without reporting a collision', (): void => {
    expect(
      runRowset(
        createSerializer(),
        createRowset([
          { name: 'P_CUR', dbType: oracledb.DB_TYPE_CURSOR },
          { name: 'ORDER_ID' },
        ])
      )
    ).toEqual(['P_CUR', 'orderId']);
  });

  it('rejects a column that transforms onto an untouched cursor column name', (): void => {
    expect(() =>
      runRowset(
        createSerializer(),
        createRowset([
          { name: 'orderId', dbType: oracledb.DB_TYPE_CURSOR },
          { name: 'ORDER_ID' },
        ])
      )
    ).toThrow(
      'Oracle result columns "orderId" and "ORDER_ID" have conflicting transformed name "orderId"'
    );
  });

  it('keeps working when the driver supplies no rowset metadata', (): void => {
    const serializer = createSerializer();
    const handler = serializer.createFetchTypeHandler();
    const column: oracledb.Metadata<unknown> = {
      name: 'ORDER_ID',
      dbType: oracledb.DB_TYPE_VARCHAR,
    };

    expect(handler(column)).toBeUndefined();
    expect(column.name).toBe('orderId');
  });
});
