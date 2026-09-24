import { Readable } from 'node:stream';

import oracledb from 'oracledb';
import { describe, expect, it } from 'vitest';

import { OracleProcedureResultMaterializer } from '../../src/adapters/oracle/oracle-result-materializer.js';
import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
import { ServerError } from '../../src/utils/server-error.js';
import { StringUtilities } from '../../src/utils/string-utilities.js';
import { createLogger } from '../support/helpers.js';

import type { IOracleValueSerializer } from '../../src/interfaces/oracle-result-materializer.interfaces.js';
import type { IProcedureOutBinding } from '../../src/interfaces/utility.interfaces.js';
import type { ITestLogger } from '../support/helpers.js';

const CURSOR_NAME = 'P_CUR';

const cursorBinding: IProcedureOutBinding = {
  name: CURSOR_NAME,
  type: 'cursor',
};

const passthroughSerializer: IOracleValueSerializer = {
  serializeValue: (_serializerType: string, value: unknown): unknown => value,
};

function createMaterializer(
  logger: ITestLogger = createLogger()
): OracleProcedureResultMaterializer {
  return new OracleProcedureResultMaterializer(
    logger,
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string =>
          StringUtilities.toCamelCase(value),
      },
    },
    passthroughSerializer
  );
}

function createCursor(
  columnNames: Array<string>,
  rows: Array<unknown>
): Record<string, unknown> {
  return {
    metaData: columnNames.map((name: string) => ({
      name,
      dbTypeName: 'VARCHAR2',
    })),
    toQueryStream: (): Readable => Readable.from(rows, { objectMode: true }),
    close: (): Promise<void> => Promise.resolve(),
  };
}

async function materializeCursor(
  columnNames: Array<string>,
  rows: Array<unknown>
): Promise<Array<Record<string, unknown>>> {
  const result = await createMaterializer().materialize<
    Record<string, unknown>
  >([CURSOR_NAME], [cursorBinding], {
    [CURSOR_NAME]: createCursor(columnNames, rows),
  });
  return result.rows;
}

async function materializeUndescribedCursor(
  logger: ITestLogger,
  metaData: unknown,
  rows: Array<unknown>
): Promise<Array<Record<string, unknown>>> {
  const cursor = {
    metaData,
    toQueryStream: (): Readable => Readable.from(rows, { objectMode: true }),
    close: (): Promise<void> => Promise.resolve(),
  };
  const result = await createMaterializer(logger).materialize<
    Record<string, unknown>
  >([CURSOR_NAME], [cursorBinding], { [CURSOR_NAME]: cursor });
  return result.rows;
}

describe('Oracle cursor column names', (): void => {
  it('rejects two columns the driver handed over under one name', async (): Promise<void> => {
    const rows = materializeCursor(['orderId', 'orderId'], [[1, 2]]);

    await expect(rows).rejects.toBeInstanceOf(ServerError);
    await expect(rows).rejects.toThrow(
      'Oracle result set returned two columns named "orderId"'
    );
  });

  it('rejects that duplicate in rows keyed by column name too', async (): Promise<void> => {
    await expect(
      materializeCursor(['orderId', 'orderId'], [{ orderId: 1 }])
    ).rejects.toThrow('Oracle result set returned two columns named "orderId"');
  });

  it('refuses raw names that collide after case conversion, where the driver asks', (): void => {
    const serializer = new OracleSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string =>
          StringUtilities.toCamelCase(value),
      },
    });
    const rowset = [
      { name: 'ORDER_ID', dbType: oracledb.DB_TYPE_NUMBER },
      { name: 'order id', dbType: oracledb.DB_TYPE_VARCHAR },
    ];
    const handler = serializer.createFetchTypeHandler();

    expect(() => handler(rowset[0] as never, rowset as never)).toThrow(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });

  it('uses the names the driver produced, without converting them again', async (): Promise<void> => {
    await expect(
      materializeCursor(['orderId', 'orderName'], [[1, 'first']])
    ).resolves.toEqual([{ orderId: 1, orderName: 'first' }]);
  });

  it('accepts a single column across several rows', async (): Promise<void> => {
    await expect(materializeCursor(['orderId'], [[1], [2]])).resolves.toEqual([
      { orderId: 1 },
      { orderId: 2 },
    ]);
  });

  it('skips a column missing from a named row', async (): Promise<void> => {
    await expect(
      materializeCursor(['orderId', 'orderName'], [{ orderId: 1 }])
    ).resolves.toEqual([{ orderId: 1 }]);
  });

  it('leaves rows untransformed when the cursor exposes no metadata', async (): Promise<void> => {
    const logger = createLogger();
    const materializer = createMaterializer(logger);
    const cursor = createCursor([], [{ ORDER_ID: 1, 'order id': 2 }]);

    await expect(
      materializer.materialize<Record<string, unknown>>(
        [CURSOR_NAME],
        [cursorBinding],
        { [CURSOR_NAME]: cursor }
      )
    ).resolves.toEqual({
      rows: [{ ORDER_ID: 1, 'order id': 2 }],
      outBinds: { pCur: [{ ORDER_ID: 1, 'order id': 2 }] },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Oracle cursor "P_CUR" came back without a usable column description, so its rows are returned as the driver produced them, without the duplicate column name check'
    );
  });
});

/** A stand-in for node-oracledb's Lob: an async iterable handle to destroy. */
class FakeLob {
  public destroyed = false;
  public readonly type = oracledb.DB_TYPE_CLOB;

  public constructor(private readonly chunks: Array<string>) {}

  public destroy(): void {
    this.destroyed = true;
  }

  public async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    for (const chunk of this.chunks) yield chunk;
  }
}

describe('Oracle LOB handles inside cursor rows', (): void => {
  it('destroys the handles of a row whose earlier column failed', async (): Promise<void> => {
    const oversized = new FakeLob(['0123456789']);
    const untouched = new FakeLob(['short']);
    const materializer = new OracleProcedureResultMaterializer(
      createLogger(),
      {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy: {
          transformColumnName: (value: string): string =>
            StringUtilities.toCamelCase(value),
        },
        resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxLobBytes: 4 },
      },
      passthroughSerializer
    );
    const cursor = {
      metaData: [{ name: 'bigDoc' }, { name: 'otherDoc' }],
      toQueryStream: (): Readable =>
        Readable.from([{ bigDoc: oversized, otherDoc: untouched }], {
          objectMode: true,
        }),
      close: (): Promise<void> => Promise.resolve(),
    };

    await expect(
      materializer.materialize<Record<string, unknown>>(
        [CURSOR_NAME],
        [cursorBinding],
        { [CURSOR_NAME]: cursor }
      )
    ).rejects.toThrow('Oracle LOB exceeds resourceLimits.maxLobBytes (4)');
    expect(oversized.destroyed).toBe(true);
    expect(untouched.destroyed).toBe(true);
  });

  it('does not leave a materialized row LOB registered for a second destroy', async (): Promise<void> => {
    const document = new FakeLob(['hello']);
    let destroyCalls = 0;
    const countingDocument = Object.assign(document, {
      destroy: (): void => {
        destroyCalls += 1;
        document.destroyed = true;
      },
    });
    const cursor = {
      metaData: [{ name: 'doc' }],
      toQueryStream: (): Readable =>
        Readable.from([{ doc: countingDocument }], { objectMode: true }),
      close: (): Promise<void> => Promise.resolve(),
    };

    await expect(
      createMaterializer().materialize<Record<string, unknown>>(
        [CURSOR_NAME],
        [cursorBinding],
        { [CURSOR_NAME]: cursor }
      )
    ).resolves.toEqual({
      rows: [{ doc: 'hello' }],
      outBinds: { pCur: [{ doc: 'hello' }] },
    });
    expect(destroyCalls).toBe(1);
  });
});

describe('Oracle cursor metadata the driver could not describe', (): void => {
  it('says so instead of degrading in silence when the metadata is missing', async (): Promise<void> => {
    const logger = createLogger();

    await expect(
      materializeUndescribedCursor(logger, undefined, [
        { orderId: 1, orderName: 'first' },
      ])
    ).resolves.toEqual([{ orderId: 1, orderName: 'first' }]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Oracle cursor "P_CUR" came back without a usable column description, so its rows are returned as the driver produced them, without the duplicate column name check'
    );
  });

  it('says so when the metadata entries carry no name', async (): Promise<void> => {
    const logger = createLogger();

    await expect(
      materializeUndescribedCursor(
        logger,
        [{ dbTypeName: 'VARCHAR2' }],
        [{ orderId: 1 }]
      )
    ).resolves.toEqual([{ orderId: 1 }]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Oracle cursor "P_CUR" came back without a usable column description, so its rows are returned as the driver produced them, without the duplicate column name check'
    );
  });

  it('still drains the LOB handles of an undescribed row', async (): Promise<void> => {
    const document = new FakeLob(['hello']);

    await expect(
      materializeUndescribedCursor(createLogger(), 'not an array', [
        { doc: document },
      ])
    ).resolves.toEqual([{ doc: 'hello' }]);
    expect(document.destroyed).toBe(true);
  });
});
