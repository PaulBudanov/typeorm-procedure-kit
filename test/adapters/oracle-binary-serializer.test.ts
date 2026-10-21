import { Readable } from 'node:stream';

import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleProcedureResultMaterializer } from '../../src/adapters/oracle/oracle-result-materializer.js';
import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { StringUtilities } from '../../src/utils/string-utilities.js';
import { createLogger } from '../support/helpers.js';

import type { IProcedureOutBinding } from '../../src/interfaces/utility.interfaces.js';
import type { TSerializerStrategy } from '../../src/types/serializer.types.js';
import type { Mock } from 'vitest';

/**
 * A registered BINARY serializer on Oracle, through the real fetch type
 * handler.
 *
 * The bundled driver sets `oracledb.fetchAsBuffer = [DB_TYPE_BLOB]` when it
 * connects (`OracleDriver.connect`), so a BLOB column reaches the caller as a
 * Buffer. A fetch type handler that answers with a `type` takes precedence
 * over that setting (`ResultSetImpl._determineFetchType` in node-oracledb),
 * and a column fetched as `DB_TYPE_BLOB` reaches its converter as a `Lob`
 * handle rather than as its contents (`ResultSet._processRows` wraps every
 * `lobIndices` value in a `Lob` before it runs the converters). The handler
 * therefore asks for a BLOB column as `DB_TYPE_RAW`, a conversion the driver
 * supports, so the strategy receives the Buffer the caller would have.
 */

const caseStrategy = {
  transformColumnName: (value: string): string =>
    StringUtilities.toCamelCase(value),
  destroy: (): void => undefined,
};

interface IDriverColumn {
  name: string;
  dbType: oracledb.DbType;
}

const BLOB_COLUMN: IDriverColumn = {
  name: 'PAYLOAD',
  dbType: oracledb.DB_TYPE_BLOB,
};
const RAW_COLUMN: IDriverColumn = {
  name: 'CHECKSUM',
  dbType: oracledb.DB_TYPE_RAW,
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

function registerHexBinarySerializer(
  serializer: OracleSerializer
): Mock<TSerializerStrategy<'BINARY'>> {
  const strategy = vi.fn<TSerializerStrategy<'BINARY'>>(({ value }) =>
    Buffer.isBuffer(value) ? value.toString('hex') : value
  );
  serializer.setSerializer({ serializerType: 'BINARY', strategy });
  return strategy;
}

/** Asks the fetch type handler about one column, as the driver would. */
function describeColumn(
  serializer: OracleSerializer,
  column: IDriverColumn
): oracledb.FetchTypeResponse | undefined {
  const metaData = { ...column };
  return serializer.createFetchTypeHandler()(
    metaData as never,
    [metaData] as never
  );
}

/** A node-oracledb `Lob`, the class the driver wraps a fetched LOB in. */
function createDriverLob(): oracledb.Lob {
  const { Lob } = oracledb as unknown as { Lob: new () => oracledb.Lob };
  return new Lob();
}

/** A drainable LOB OUT bind, the shape the materializer reads. */
function createLobOut(type: oracledb.DbType, contents: Buffer): oracledb.Lob {
  const lob = Readable.from([contents]) as unknown as oracledb.Lob;
  Object.defineProperty(lob, 'type', { value: type });
  return lob;
}

function isLobFetchType(fetchType: oracledb.DbType): boolean {
  return (
    fetchType === oracledb.DB_TYPE_BLOB || fetchType === oracledb.DB_TYPE_CLOB
  );
}

/**
 * Drives a REF CURSOR through the steps node-oracledb takes for it: the fetch
 * type handler is called once per column with the whole rowset, a `type` it
 * answers with replaces the `fetchAsBuffer` default (a BLOB otherwise comes
 * back as a Buffer), a LOB fetch type turns the value into a `Lob` handle, and
 * the converter runs while rows are read, so its error surfaces through the
 * stream as the driver's would.
 */
function createFetchedCursor(
  serializer: OracleSerializer,
  columns: Array<IDriverColumn>,
  rows: Array<Array<unknown>>
): Record<string, unknown> {
  const metaData = columns.map((column) => ({ ...column }));
  const handler = serializer.createFetchTypeHandler();
  const fetchColumns = metaData.map((column) => {
    const response = handler(column as never, metaData as never);
    const fetchType =
      response?.type ??
      (column.dbType === oracledb.DB_TYPE_BLOB
        ? oracledb.DB_TYPE_LONG_RAW
        : column.dbType);
    return {
      name: column.name,
      fetchType,
      converter: response?.converter as
        | ((value: unknown) => unknown)
        | undefined,
    };
  });
  function* fetchRows(): Generator<Record<string, unknown>> {
    for (const values of rows) {
      yield Object.fromEntries(
        fetchColumns.map(({ name, fetchType, converter }, index) => {
          const fetched = isLobFetchType(fetchType)
            ? createDriverLob()
            : values[index];
          return [name, converter ? converter(fetched) : fetched];
        })
      );
    }
  }
  return {
    metaData,
    toQueryStream: (): Readable =>
      Readable.from(fetchRows(), { objectMode: true }),
    close: (): Promise<void> => Promise.resolve(),
  };
}

async function materializeFetchedCursor(
  serializer: OracleSerializer,
  columns: Array<IDriverColumn>,
  rows: Array<Array<unknown>>
): Promise<Array<Record<string, unknown>>> {
  const result = await createMaterializer(serializer).materialize<
    Record<string, unknown>
  >(['P_CUR'], [{ name: 'P_CUR', type: 'cursor' }], {
    P_CUR: createFetchedCursor(serializer, columns, rows),
  });
  return result.rows;
}

describe('Oracle BINARY serializer on fetched columns', (): void => {
  it('leaves BLOB and RAW columns to the driver while no BINARY serializer is registered', async (): Promise<void> => {
    const serializer = createSerializer();

    expect(describeColumn(serializer, BLOB_COLUMN)).toBeUndefined();
    expect(describeColumn(serializer, RAW_COLUMN)).toBeUndefined();
    await expect(
      materializeFetchedCursor(
        serializer,
        [BLOB_COLUMN, RAW_COLUMN],
        [[Buffer.from([0xde, 0xad]), Buffer.from([0xbe, 0xef])]]
      )
    ).resolves.toEqual([
      {
        payload: Buffer.from([0xde, 0xad]),
        checksum: Buffer.from([0xbe, 0xef]),
      },
    ]);
  });

  it('asks the driver for a BLOB column as a Buffer rather than a Lob handle', (): void => {
    const serializer = createSerializer();
    registerHexBinarySerializer(serializer);

    const response = describeColumn(serializer, BLOB_COLUMN);

    expect(response?.type).toBe(oracledb.DB_TYPE_RAW);
    expect(response?.converter).toBeTypeOf('function');
  });

  it('hands the strategy the BLOB contents with the column context', (): void => {
    const serializer = createSerializer();
    const strategy = registerHexBinarySerializer(serializer);
    const contents = Buffer.from([0xde, 0xad]);

    const converter = describeColumn(serializer, BLOB_COLUMN)?.converter as (
      value: unknown
    ) => unknown;

    expect(converter(contents)).toBe('dead');
    expect(strategy).toHaveBeenCalledExactlyOnceWith({
      serializerType: 'BINARY',
      value: contents,
      context: {
        source: 'fetch',
        database: 'oracle',
        name: 'payload',
        databaseType: 'BLOB',
      },
    });
  });

  it('serializes the BLOB and RAW columns of a REF CURSOR', async (): Promise<void> => {
    const serializer = createSerializer();
    const strategy = registerHexBinarySerializer(serializer);

    await expect(
      materializeFetchedCursor(
        serializer,
        [BLOB_COLUMN, RAW_COLUMN],
        [[Buffer.from([0xde, 0xad]), Buffer.from([0xbe, 0xef])]]
      )
    ).resolves.toEqual([{ payload: 'dead', checksum: 'beef' }]);
    expect(
      strategy.mock.calls.map(([{ context }]) => context?.databaseType)
    ).toEqual(['BLOB', 'RAW']);
  });

  it('stops converting BLOB and RAW columns once the BINARY serializer is deleted', (): void => {
    const serializer = createSerializer();
    registerHexBinarySerializer(serializer);
    const whileRegistered = [BLOB_COLUMN, RAW_COLUMN].map(
      (column) => describeColumn(serializer, column)?.type
    );

    serializer.deleteSerializer({ serializerType: 'BINARY' });

    expect(whileRegistered).toEqual([
      oracledb.DB_TYPE_RAW,
      oracledb.DB_TYPE_RAW,
    ]);
    expect(describeColumn(serializer, BLOB_COLUMN)).toBeUndefined();
    expect(describeColumn(serializer, RAW_COLUMN)).toBeUndefined();
  });
});

describe('Oracle BINARY serializer on OUT binds', (): void => {
  it('serializes a BLOB scalar OUT once drained, as it does a RAW one', async (): Promise<void> => {
    const serializer = createSerializer();
    const strategy = registerHexBinarySerializer(serializer);
    const outBindings: Array<IProcedureOutBinding> = [
      { name: 'P_DOC', type: 'lob', databaseType: 'BLOB' },
      { name: 'P_CHECKSUM', type: 'scalar', databaseType: 'RAW' },
    ];

    const result = await createMaterializer(serializer).materialize<
      Record<string, unknown>
    >([], outBindings, {
      P_DOC: createLobOut(oracledb.DB_TYPE_BLOB, Buffer.from([0xde, 0xad])),
      P_CHECKSUM: Buffer.from([0xbe, 0xef]),
    });

    expect(result.outBinds).toEqual({ pDoc: 'dead', pChecksum: 'beef' });
    expect(strategy).toHaveBeenCalledWith({
      serializerType: 'BINARY',
      value: Buffer.from([0xde, 0xad]),
      context: {
        source: 'scalar-out',
        database: 'oracle',
        name: 'pDoc',
        databaseType: 'BLOB',
      },
    });
  });
});
