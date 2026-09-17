import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { OracleProcedureResultMaterializer } from '../../src/adapters/oracle/oracle-result-materializer.js';
import { ServerError } from '../../src/utils/server-error.js';
import { StringUtilities } from '../../src/utils/string-utilities.js';
import { createLogger } from '../support/helpers.js';

import type { IOracleValueSerializer } from '../../src/interfaces/oracle-result-materializer.interfaces.js';
import type { IProcedureOutBinding } from '../../src/interfaces/utility.interfaces.js';

const CURSOR_NAME = 'P_CUR';

const cursorBinding: IProcedureOutBinding = {
  name: CURSOR_NAME,
  type: 'cursor',
};

const passthroughSerializer: IOracleValueSerializer = {
  serializeValue: (_serializerType: string, value: unknown): unknown => value,
};

function createMaterializer(): OracleProcedureResultMaterializer {
  return new OracleProcedureResultMaterializer(
    createLogger(),
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

describe('Oracle cursor column name collisions', (): void => {
  it('rejects two distinct columns that transform to the same name', async (): Promise<void> => {
    const rows = materializeCursor(['ORDER_ID', 'order id'], [[1, 2]]);

    await expect(rows).rejects.toBeInstanceOf(ServerError);
    await expect(rows).rejects.toThrow(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });

  it('rejects a collision produced by the case strategy itself', async (): Promise<void> => {
    await expect(
      materializeCursor(['COL_2', 'col2'], [['a', 'b']])
    ).rejects.toThrow(
      'Oracle result columns "COL_2" and "col2" have conflicting transformed name "col2"'
    );
  });

  it('rejects a collision in rows keyed by column name', async (): Promise<void> => {
    await expect(
      materializeCursor(
        ['ORDER_ID', 'order id'],
        [{ ORDER_ID: 1, 'order id': 2 }]
      )
    ).rejects.toThrow(
      'Oracle result columns "ORDER_ID" and "order id" have conflicting transformed name "orderId"'
    );
  });

  it('keeps every column when transformed names are unique', async (): Promise<void> => {
    await expect(
      materializeCursor(['ORDER_ID', 'ORDER_NAME'], [[1, 'first']])
    ).resolves.toEqual([{ orderId: 1, orderName: 'first' }]);
  });

  it('accepts a single column whose raw name appears once', async (): Promise<void> => {
    await expect(materializeCursor(['ORDER_ID'], [[1], [2]])).resolves.toEqual([
      { orderId: 1 },
      { orderId: 2 },
    ]);
  });

  it('does not report a collision for a column missing from a named row', async (): Promise<void> => {
    await expect(
      materializeCursor(['ORDER_ID', 'order id'], [{ ORDER_ID: 1 }])
    ).resolves.toEqual([{ orderId: 1 }]);
  });

  it('leaves rows untransformed when the cursor exposes no metadata', async (): Promise<void> => {
    const materializer = createMaterializer();
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
  });
});
