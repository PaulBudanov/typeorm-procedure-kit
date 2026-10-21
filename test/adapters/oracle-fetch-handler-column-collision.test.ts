import oracledb from 'oracledb';
import { describe, expect, it } from 'vitest';

import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { runInKitCall } from '../../src/utils/kit-call-context.js';
import { ServerError } from '../../src/utils/server-error.js';
import { StringUtilities } from '../../src/utils/string-utilities.js';
import { createLogger } from '../support/helpers.js';

import type { ITestLogger } from '../support/helpers.js';

const caseStrategy = {
  transformColumnName: (value: string): string =>
    StringUtilities.toCamelCase(value),
  destroy: (): void => undefined,
};

function createSerializer(
  logger: ITestLogger = createLogger()
): OracleSerializer {
  return new OracleSerializer(logger, {
    isNeedRegisterDefaultSerializers: false,
    caseStrategy,
  });
}

/**
 * Runs a synchronous handler drive the way `call()` and `callSqlTransaction()` run it.
 * @param drive - drives the fetch type handler.
 * @returns what the drive returned, or the rejection it threw.
 */
async function inKitCall<T>(drive: () => T): Promise<T> {
  return runInKitCall(async (): Promise<T> => drive());
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
  it('rejects two distinct columns that transform to the same name inside a kit call', async (): Promise<void> => {
    const rowset = createRowset([{ name: 'ORDER_ID' }, { name: 'order id' }]);

    await expect(
      inKitCall(() => runRowset(createSerializer(), rowset))
    ).rejects.toThrow(ServerError);
    await expect(
      inKitCall(() =>
        runRowset(
          createSerializer(),
          createRowset([{ name: 'ORDER_ID' }, { name: 'order id' }])
        )
      )
    ).rejects.toThrow(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });

  it('warns once outside a kit call and still renames every column', (): void => {
    const logger = createLogger();
    const rowset = createRowset([
      { name: 'ORDER_ID' },
      { name: 'order id' },
      { name: 'AMOUNT' },
    ]);

    expect(runRowset(createSerializer(logger), rowset)).toEqual([
      'orderId',
      'orderId',
      'amount',
    ]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });

  it('rejects a collision produced by the case strategy itself inside a kit call', async (): Promise<void> => {
    await expect(
      inKitCall(() =>
        runRowset(
          createSerializer(),
          createRowset([{ name: 'COL_2' }, { name: 'col2' }])
        )
      )
    ).rejects.toThrow(
      'Oracle result columns "COL_2" and "col2" have conflicting transformed name "col2"'
    );
  });

  it('warns about a collision produced by the case strategy outside a kit call', (): void => {
    const logger = createLogger();

    expect(
      runRowset(
        createSerializer(logger),
        createRowset([{ name: 'COL_2' }, { name: 'col2' }])
      )
    ).toEqual(['col2', 'col2']);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'Oracle result columns "COL_2" and "col2" have conflicting transformed name "col2"'
    );
  });

  it('warns about two columns of one raw name outside a kit call', (): void => {
    // `SELECT 1 AS id, 2 AS id`: the driver later keeps both, as `id` and `id_1`.
    const logger = createLogger();

    expect(
      runRowset(
        createSerializer(logger),
        createRowset([{ name: 'ID' }, { name: 'ID' }])
      )
    ).toEqual(['id', 'id']);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'Oracle result columns "ID" and "ID" have conflicting transformed name "id"'
    );
  });

  it('accepts two separate queries that share a column name', async (): Promise<void> => {
    const logger = createLogger();

    const names = await inKitCall(() =>
      runRowsetsOnSharedHandler(createSerializer(logger), [
        createRowset([{ name: 'ORDER_ID' }, { name: 'CUSTOMER_NAME' }]),
        createRowset([{ name: 'ORDER_ID' }, { name: 'TOTAL_SUM' }]),
        createRowset([{ name: 'ORDER_ID' }]),
      ])
    );

    expect(names).toEqual([
      ['orderId', 'customerName'],
      ['orderId', 'totalSum'],
      ['orderId'],
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('accepts the same query executed repeatedly on one handler', async (): Promise<void> => {
    const serializer = createSerializer();
    const handler = serializer.createFetchTypeHandler();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rowset = createRowset([{ name: 'ORDER_ID' }, { name: 'AMOUNT' }]);
      await inKitCall((): void => {
        for (const column of rowset) handler(column, rowset);
      });
      expect(rowset.map(({ name }) => name)).toEqual(['orderId', 'amount']);
    }
  });

  it('accepts a single column', (): void => {
    expect(
      runRowset(createSerializer(), createRowset([{ name: 'ORDER_ID' }]))
    ).toEqual(['orderId']);
  });

  it('leaves cursor columns unrenamed without reporting a collision', async (): Promise<void> => {
    await expect(
      inKitCall(() =>
        runRowset(
          createSerializer(),
          createRowset([
            { name: 'P_CUR', dbType: oracledb.DB_TYPE_CURSOR },
            { name: 'ORDER_ID' },
          ])
        )
      )
    ).resolves.toEqual(['P_CUR', 'orderId']);
  });

  it('rejects a column that transforms onto an untouched cursor column name', async (): Promise<void> => {
    await expect(
      inKitCall(() =>
        runRowset(
          createSerializer(),
          createRowset([
            { name: 'orderId', dbType: oracledb.DB_TYPE_CURSOR },
            { name: 'ORDER_ID' },
          ])
        )
      )
    ).rejects.toThrow(
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

describe('Oracle fetch handler column name collisions in thick mode', (): void => {
  /** A driver-shaped column before node-oracledb has normalised its `dbType`. */
  interface IDriverColumn {
    name: string;
    dbType: number | oracledb.DbType;
  }

  /** The rowset array node-oracledb hands over is not the declared shape yet. */
  function asMetaData(column: IDriverColumn): oracledb.Metadata<unknown> {
    return column as unknown as oracledb.Metadata<unknown>;
  }

  /**
   * Drives the handler the way node-oracledb thick mode drives it.
   *
   * Thick mode reports `dbType` as its numeric code. `lib/impl/resultset.js`
   * `_setup` normalises one column at a time — `addTypeProperties(info,
   * 'dbType')` — immediately before it invokes the fetch type handler for that
   * same column, so when the handler runs for column 0 every later column still
   * carries a number.
   */
  function runRowsetThickMode(
    serializer: OracleSerializer,
    columns: ReadonlyArray<{ name: string; dbType?: oracledb.DbType }>
  ): Array<string> {
    const dbTypes = columns.map(
      ({ dbType }) => dbType ?? oracledb.DB_TYPE_VARCHAR
    );
    const rowset: Array<IDriverColumn> = columns.map(({ name }, index) => ({
      name,
      dbType: (dbTypes[index] ?? oracledb.DB_TYPE_VARCHAR).num,
    }));
    const metaData = rowset.map(asMetaData);
    const handler = serializer.createFetchTypeHandler();
    rowset.forEach((column, index) => {
      column.dbType = dbTypes[index] ?? oracledb.DB_TYPE_VARCHAR;
      handler(asMetaData(column), metaData);
    });
    return rowset.map(({ name }) => name);
  }

  it('exempts a cursor column whose dbType is still a numeric code', async (): Promise<void> => {
    await expect(
      inKitCall(() =>
        runRowsetThickMode(createSerializer(), [
          { name: 'c1' },
          { name: 'C1', dbType: oracledb.DB_TYPE_CURSOR },
        ])
      )
    ).resolves.toEqual(['c1', 'C1']);
  });

  it('still rejects a genuine collision when dbType is a numeric code', async (): Promise<void> => {
    await expect(
      inKitCall(() =>
        runRowsetThickMode(createSerializer(), [
          { name: 'ORDER_ID' },
          { name: 'order id' },
        ])
      )
    ).rejects.toThrow(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });
});

describe('Oracle fetch handler rowset metadata validation', (): void => {
  /**
   * Mirrors the production case strategy, which rejects a non-string name.
   * @see OrmStrategy.transformColumnName in src/case-strategy/orm-strategy.ts
   */
  const strictCaseStrategy = {
    transformColumnName: (value: string): string => {
      if (typeof value !== 'string')
        throw new ServerError('Column name must be a string');
      return StringUtilities.toCamelCase(value);
    },
    destroy: (): void => undefined,
  };

  function createStrictSerializer(): OracleSerializer {
    return new OracleSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: strictCaseStrategy,
    });
  }

  /**
   * `@types/oracledb` declares the fetch type handler with one parameter, so a
   * driver in the supported `^6.0.0 || ^7.0.0` range may pass anything — or
   * nothing — as the second argument.
   */
  function asRowset(value: unknown): ReadonlyArray<oracledb.Metadata<unknown>> {
    return value as ReadonlyArray<oracledb.Metadata<unknown>>;
  }

  it('skips the check when the second argument is not an array', async (): Promise<void> => {
    const handler = createStrictSerializer().createFetchTypeHandler();
    const column: oracledb.Metadata<unknown> = {
      name: 'ORDER_ID',
      dbType: oracledb.DB_TYPE_VARCHAR,
    };

    await expect(
      inKitCall(() => handler(column, asRowset({ 0: column, length: 1 })))
    ).resolves.toBeUndefined();
    expect(column.name).toBe('orderId');
  });

  it('skips rowset entries whose name is not a string', async (): Promise<void> => {
    const handler = createStrictSerializer().createFetchTypeHandler();
    const column: oracledb.Metadata<unknown> = {
      name: 'ORDER_ID',
      dbType: oracledb.DB_TYPE_VARCHAR,
    };
    const rowset = [column, { name: 42, dbType: oracledb.DB_TYPE_VARCHAR }];

    await expect(
      inKitCall(() => handler(column, asRowset(rowset)))
    ).resolves.toBeUndefined();
    expect(column.name).toBe('orderId');
  });

  it('still reports a collision between the well-formed entries', async (): Promise<void> => {
    const handler = createStrictSerializer().createFetchTypeHandler();
    const column: oracledb.Metadata<unknown> = {
      name: 'ORDER_ID',
      dbType: oracledb.DB_TYPE_VARCHAR,
    };
    const rowset = [
      column,
      { dbType: oracledb.DB_TYPE_VARCHAR },
      { name: 'order id', dbType: oracledb.DB_TYPE_VARCHAR },
    ];

    await expect(
      inKitCall(() => handler(column, asRowset(rowset)))
    ).rejects.toThrow(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });
});
