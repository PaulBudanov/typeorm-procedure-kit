import { Readable } from 'node:stream';

import oracledb from 'oracledb';
import { describe, expect, it } from 'vitest';

import { OracleProcedureResultMaterializer } from '../../src/adapters/oracle/oracle-result-materializer.js';
import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { StringUtilities } from '../../src/utils/string-utilities.js';
import { createLogger } from '../support/helpers.js';

import type { IProcedureOutBinding } from '../../src/interfaces/utility.interfaces.js';

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

function createMaterializer(
  serializer: OracleSerializer
): OracleProcedureResultMaterializer {
  return new OracleProcedureResultMaterializer(
    createLogger(),
    { isNeedRegisterDefaultSerializers: false, caseStrategy },
    serializer
  );
}

function scalarOut(name: string, databaseType: string): IProcedureOutBinding {
  return { name, type: 'scalar', databaseType };
}

async function materializeScalarOuts(
  serializer: OracleSerializer,
  outBindings: Array<IProcedureOutBinding>,
  rawOutBinds: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = await createMaterializer(serializer).materialize<
    Record<string, unknown>
  >([], outBindings, rawOutBinds);
  return result.outBinds;
}

/**
 * Drives a REF CURSOR through the same steps node-oracledb takes for a nested
 * result set: the fetch type handler is called once per column with the whole
 * rowset (`ResultSetImpl._setup`), it renames the column and may install a
 * converter, duplicate output names are suffixed, and every value is passed
 * through its column's converter before the row leaves the driver.
 */
function createFetchedCursor(
  serializer: OracleSerializer,
  columns: Array<{ name: string; dbType: oracledb.DbType }>,
  rows: Array<Array<unknown>>
): Record<string, unknown> {
  const metaData = columns.map((column) => ({ ...column }));
  const handler = serializer.createFetchTypeHandler();
  const converters: Array<((value: unknown) => unknown) | undefined> = [];
  const takenNames = new Map<string, number>();
  for (const [index, column] of metaData.entries()) {
    converters.push(
      handler(column as never, metaData as never)?.converter as
        | ((value: unknown) => unknown)
        | undefined
    );
    let name = column.name;
    for (let suffix = 1; takenNames.has(name); suffix += 1)
      name = `${column.name}_${suffix}`;
    takenNames.set(name, index);
    column.name = name;
  }
  const fetchedRows = rows.map((values) =>
    Object.fromEntries(
      metaData.map(({ name }, index) => {
        const converter = converters[index];
        const value = values[index];
        return [name, converter ? converter(value) : value];
      })
    )
  );
  return {
    metaData,
    toQueryStream: (): Readable =>
      Readable.from(fetchedRows, { objectMode: true }),
    close: (): Promise<void> => Promise.resolve(),
  };
}

async function materializeFetchedCursor(
  serializer: OracleSerializer,
  columns: Array<{ name: string; dbType: oracledb.DbType }>,
  rows: Array<Array<unknown>>
): Promise<Array<Record<string, unknown>>> {
  const result = await createMaterializer(serializer).materialize<
    Record<string, unknown>
  >(['P_CUR'], [{ name: 'P_CUR', type: 'cursor' }], {
    P_CUR: createFetchedCursor(serializer, columns, rows),
  });
  return result.rows;
}

describe('Oracle cursor columns the driver already converted', (): void => {
  it('does not run the case strategy a second time', async (): Promise<void> => {
    const serializer = createSerializer();
    const cursor = createFetchedCursor(
      serializer,
      [{ name: 'A_B_C', dbType: oracledb.DB_TYPE_VARCHAR }],
      [['first']]
    );
    const driverColumnName = (cursor.metaData as Array<{ name: string }>)[0]
      ?.name;

    const rows = await createMaterializer(serializer).materialize<
      Record<string, unknown>
    >(['P_CUR'], [{ name: 'P_CUR', type: 'cursor' }], { P_CUR: cursor });

    expect(driverColumnName).toBe('aBC');
    expect(rows.rows).toEqual([{ aBC: 'first' }]);
  });

  it('names a cursor column exactly as a plain query names it', async (): Promise<void> => {
    const serializer = createSerializer();

    await expect(
      materializeFetchedCursor(
        serializer,
        [
          { name: 'ORDER_ID', dbType: oracledb.DB_TYPE_NUMBER },
          { name: 'A_B_C', dbType: oracledb.DB_TYPE_VARCHAR },
        ],
        [[1, 'first']]
      )
    ).resolves.toEqual([{ orderId: 1, aBC: 'first' }]);
  });

  it('does not run a temporal serializer a second time', async (): Promise<void> => {
    const serializer = createSerializer();
    serializer.setSerializer({
      serializerType: 'DATE',
      strategy: ({ value }) =>
        value instanceof Date ? value.getTime() : String(value),
    });

    await expect(
      materializeFetchedCursor(
        serializer,
        [{ name: 'CREATED_AT', dbType: oracledb.DB_TYPE_DATE }],
        [[new Date(2024, 0, 2, 3, 4, 5)]]
      )
    ).resolves.toEqual([
      { createdAt: new Date(2024, 0, 2, 3, 4, 5).getTime() },
    ]);
  });

  it('keeps the default temporal format the driver produced', async (): Promise<void> => {
    const serializer = createSerializer();
    serializer.registerDefaultSerializers();

    await expect(
      materializeFetchedCursor(
        serializer,
        [{ name: 'CREATED_AT', dbType: oracledb.DB_TYPE_DATE }],
        [[new Date(2024, 0, 2, 3, 4, 5)]]
      )
    ).resolves.toEqual([{ createdAt: '2024-01-02 03:04:05' }]);
  });
});

describe('Oracle scalar OUT serializers', (): void => {
  it('runs every registered serializer, not only the temporal ones', async (): Promise<void> => {
    const serializer = createSerializer();
    serializer.setSerializer({
      serializerType: 'JSON',
      strategy: ({ value }) =>
        typeof value === 'string' ? (JSON.parse(value) as unknown) : value,
    });
    serializer.setSerializer({
      serializerType: 'BOOLEAN',
      strategy: ({ value }) => value === true || value === 'Y',
    });
    serializer.setSerializer({
      serializerType: 'CHAR',
      strategy: ({ value }) => String(value).trimEnd(),
    });
    serializer.setSerializer({
      serializerType: 'VARCHAR',
      strategy: ({ value }) => `v:${String(value)}`,
    });
    serializer.setSerializer({
      serializerType: 'BINARY',
      strategy: ({ value }) =>
        Buffer.isBuffer(value) ? value.toString('hex') : value,
    });
    serializer.setSerializer({
      serializerType: 'XML',
      strategy: ({ value }) => `xml:${String(value)}`,
    });

    await expect(
      materializeScalarOuts(
        serializer,
        [
          scalarOut('P_PAYLOAD', 'JSON'),
          scalarOut('P_FLAG', 'BOOLEAN'),
          scalarOut('P_CODE', 'CHAR'),
          scalarOut('P_NAME', 'VARCHAR2'),
          scalarOut('P_BLOB', 'RAW'),
          scalarOut('P_DOC', 'XMLTYPE'),
        ],
        {
          P_PAYLOAD: '{"total":2}',
          P_FLAG: 'Y',
          P_CODE: 'AB   ',
          P_NAME: 'order',
          P_BLOB: Buffer.from([0xde, 0xad]),
          P_DOC: '<a/>',
        }
      )
    ).resolves.toEqual({
      pPayload: { total: 2 },
      pFlag: true,
      pCode: 'AB',
      pName: 'v:order',
      pBlob: 'dead',
      pDoc: 'xml:<a/>',
    });
  });

  it('matches what the same value gets as a RECORD field', async (): Promise<void> => {
    const serializer = createSerializer();
    serializer.setSerializer({
      serializerType: 'BOOLEAN',
      strategy: ({ value }) => value === 'Y',
    });

    const asScalar = await materializeScalarOuts(
      serializer,
      [scalarOut('P_FLAG', 'BOOLEAN')],
      { P_FLAG: 'Y' }
    );
    const asRecordField = await materializeScalarOuts(
      serializer,
      [
        {
          name: 'P_ROW',
          type: 'object',
          databaseType: 'PKG.T_ROW',
          structuredType: {
            kind: 'oracle-record',
            typeName: 'PKG.T_ROW',
            fields: [{ name: 'FLAG', argumentType: 'BOOLEAN', order: 1 }],
          },
        },
      ],
      { P_ROW: { FLAG: 'Y' } }
    );

    expect(asScalar).toEqual({ pFlag: true });
    expect(asRecordField).toEqual({ pRow: { flag: true } });
  });

  it('leaves a scalar OUT alone when no serializer is registered', async (): Promise<void> => {
    await expect(
      materializeScalarOuts(
        createSerializer(),
        [scalarOut('P_NAME', 'VARCHAR2'), scalarOut('P_FLAG', 'BOOLEAN')],
        { P_NAME: 'order', P_FLAG: 'Y' }
      )
    ).resolves.toEqual({ pName: 'order', pFlag: 'Y' });
  });

  it('accepts a lower case database type from the dictionary', async (): Promise<void> => {
    const serializer = createSerializer();
    serializer.setSerializer({
      serializerType: 'VARCHAR',
      strategy: ({ value }) => `v:${String(value)}`,
    });

    await expect(
      materializeScalarOuts(serializer, [scalarOut('P_NAME', 'varchar2')], {
        P_NAME: 'order',
      })
    ).resolves.toEqual({ pName: 'v:order' });
  });
});
