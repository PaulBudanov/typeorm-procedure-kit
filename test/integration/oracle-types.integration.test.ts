import oracledb from 'oracledb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createOracleIntegrationSettings,
  ensureOracleClientMode,
  withKit,
  withOracleConnection,
} from './database-integration.helpers.js';

import type {
  ISerializerContext,
  TOracleDbConfig,
  TypeOrmProcedureKit,
} from '../../src/index.js';

const settings = createOracleIntegrationSettings();
const typesPackage = 'tpk_it_types_pkg' as const;
const typesPackageName = typesPackage.toUpperCase();
const jsonPackage = 'tpk_it_types_json_pkg' as const;
const jsonPackageName = jsonPackage.toUpperCase();
const rowsTableName = 'TPK_IT_TYPES_ROWS';
/** Oracle error code of `DROP PACKAGE` on a package that does not exist. */
const missingPackageCode = -4043;
/** Oracle error code of `DROP TABLE` on a table that does not exist. */
const missingTableCode = -942;
/** Generous per-test budget: every case opens its own kit and pool on a shared CI database. */
const testTimeoutMs = 60_000;
/** Budget for creating and dropping the fixtures. */
const hookTimeoutMs = 120_000;
/** 300 Cyrillic characters: 600 bytes in UTF-8, past the 200 byte default OUT buffer. */
const cyrillicText = 'Ж'.repeat(300);
/** 20 000 characters outside the BMP: 40 000 UTF-16 code units, 80 000 UTF-8 bytes. */
const emojiText = '😀'.repeat(20_000);
const rowColumns =
  'ID, RAW_VALUE, BLOB_VALUE, CLOB_VALUE, CHAR_VALUE, NCHAR_VALUE, VARCHAR_VALUE, NVARCHAR_VALUE, FLAG_VALUE';
const selectRowsSql = `SELECT ${rowColumns} FROM ${rowsTableName} ORDER BY ID`;

type TOracleIntegrationSettings = NonNullable<
  ReturnType<typeof createOracleIntegrationSettings>
>;

/** The two runtime paths a labelled value can come from in these cases. */
type TLabelSource = Extract<
  ISerializerContext['source'],
  'fetch' | 'scalar-out'
>;

/** A package procedure as the spec and the body declare it. */
interface IPlsqlProcedure {
  /** Procedure name in upper case. */
  name: string;
  /** Parameter list without the parentheses. */
  parameters: string;
  /** Declarations of the body, empty when there are none. */
  declarations: string;
  /** Statements of the body. */
  statements: string;
}

/** One `ECHO_<type>` procedure and the values one call to it binds and returns. */
interface IScalarEchoCase {
  /** PL/SQL type of `P_INPUT`, `P_OUTPUT` and `P_IN_OUT`. */
  type: string;
  /** Procedure name in lower case, as `call()` receives it. */
  procedure: string;
  /** Declarations of the procedure body, empty when there are none. */
  declarations: string;
  /** Statements of the procedure body. */
  statements: string;
  /** Value bound to `P_INPUT`. */
  input: unknown;
  /** Value bound to `P_IN_OUT`. */
  inOut: unknown;
  /** Value the call returns for `P_OUTPUT`. */
  output: unknown;
  /** Value the call returns for `P_IN_OUT`. */
  returnedInOut: unknown;
}

/** What a label strategy returns: the label and the context it was called with. */
interface ILabelledValue {
  label: string;
  context: ISerializerContext | undefined;
}

/** One text the CLOB round trip sends and expects back. */
interface IClobTextCase {
  shape: string;
  text: string;
}

const textEcho = "P_OUTPUT := P_INPUT; P_IN_OUT := P_IN_OUT || '-io';";
const integerEcho = 'P_OUTPUT := P_INPUT + 1; P_IN_OUT := P_IN_OUT * 2;';
const floatEcho = 'P_OUTPUT := P_INPUT * 2; P_IN_OUT := P_IN_OUT + 1;';

/**
 * Builds the body of a LOB echo. `P_OUTPUT` and `P_IN_OUT` each get a temporary LOB of their own
 * instead of a locator the caller bound: node-oracledb Thin frees the temporary LOB it created for
 * an IN value on the next round trip, which is the read of the OUT value.
 * @param suffixLength - characters (CLOB) or bytes (BLOB) of the suffix.
 * @param suffix - PL/SQL expression appended to the IN OUT value.
 * @returns the statements of the procedure body.
 */
function lobEcho(suffixLength: number, suffix: string): string {
  return [
    'DBMS_LOB.CREATETEMPORARY(P_OUTPUT, TRUE);',
    'DBMS_LOB.APPEND(P_OUTPUT, P_INPUT);',
    'DBMS_LOB.CREATETEMPORARY(V_IN_OUT, TRUE);',
    'DBMS_LOB.APPEND(V_IN_OUT, P_IN_OUT);',
    `DBMS_LOB.WRITEAPPEND(V_IN_OUT, ${suffixLength}, ${suffix});`,
    'P_IN_OUT := V_IN_OUT;',
  ].join(' ');
}

/**
 * Every scalar type the IN, OUT and IN OUT round trip covers. The CHAR, NCHAR and NVARCHAR2 rows
 * characterize the driver: whether the server pads a CHAR OUT to the bind buffer, and whether it
 * accepts the NCHAR buffer node-oracledb Thin declares four times larger, is not established.
 */
const scalarEchoCases: ReadonlyArray<IScalarEchoCase> = [
  {
    type: 'CHAR',
    procedure: 'echo_char',
    declarations: '',
    statements: textEcho,
    input: cyrillicText,
    inOut: 'AB',
    output: cyrillicText,
    returnedInOut: 'AB-io',
  },
  {
    type: 'NCHAR',
    procedure: 'echo_nchar',
    declarations: '',
    statements: textEcho,
    input: cyrillicText,
    inOut: 'ЖУК',
    output: cyrillicText,
    returnedInOut: 'ЖУК-io',
  },
  {
    type: 'VARCHAR2',
    procedure: 'echo_varchar2',
    declarations: '',
    statements: textEcho,
    input: cyrillicText,
    inOut: 'abc',
    output: cyrillicText,
    returnedInOut: 'abc-io',
  },
  {
    type: 'NVARCHAR2',
    procedure: 'echo_nvarchar2',
    declarations: '',
    statements: textEcho,
    input: cyrillicText,
    inOut: 'ёлка',
    output: cyrillicText,
    returnedInOut: 'ёлка-io',
  },
  {
    type: 'BOOLEAN',
    procedure: 'echo_boolean',
    declarations: '',
    statements: 'P_OUTPUT := NOT P_INPUT; P_IN_OUT := NOT P_IN_OUT;',
    input: true,
    inOut: false,
    output: false,
    returnedInOut: true,
  },
  {
    type: 'PLS_INTEGER',
    procedure: 'echo_pls_integer',
    declarations: '',
    statements: integerEcho,
    input: 41,
    inOut: -7,
    output: 42,
    returnedInOut: -14,
  },
  {
    type: 'BINARY_INTEGER',
    procedure: 'echo_binary_integer',
    declarations: '',
    statements: integerEcho,
    input: 2_147_483_646,
    inOut: 1_073_741_823,
    output: 2_147_483_647,
    returnedInOut: 2_147_483_646,
  },
  {
    type: 'INTEGER',
    procedure: 'echo_integer',
    declarations: '',
    statements: integerEcho,
    input: 123_456_789_012,
    inOut: -21,
    output: 123_456_789_013,
    returnedInOut: -42,
  },
  {
    type: 'BINARY_FLOAT',
    procedure: 'echo_binary_float',
    declarations: '',
    statements: floatEcho,
    input: 1.5,
    inOut: 0.25,
    output: 3,
    returnedInOut: 1.25,
  },
  {
    type: 'BINARY_DOUBLE',
    procedure: 'echo_binary_double',
    declarations: '',
    statements: floatEcho,
    input: 0.1,
    inOut: 1.5,
    output: 0.2,
    returnedInOut: 2.5,
  },
  {
    type: 'RAW',
    procedure: 'echo_raw',
    declarations: '',
    statements:
      "P_OUTPUT := UTL_RAW.CONCAT(P_INPUT, HEXTORAW('FF')); P_IN_OUT := UTL_RAW.REVERSE(P_IN_OUT);",
    input: Buffer.from('deadbeef', 'hex'),
    inOut: Buffer.from('010203', 'hex'),
    output: Buffer.from('deadbeefff', 'hex'),
    returnedInOut: Buffer.from('030201', 'hex'),
  },
  {
    type: 'CLOB',
    procedure: 'echo_clob',
    declarations: 'V_IN_OUT CLOB;',
    statements: lobEcho(3, "'-io'"),
    input: 'Привет, CLOB',
    inOut: 'tail',
    output: 'Привет, CLOB',
    returnedInOut: 'tail-io',
  },
  {
    type: 'BLOB',
    procedure: 'echo_blob',
    declarations: 'V_IN_OUT BLOB;',
    statements: lobEcho(1, "HEXTORAW('FF')"),
    input: Buffer.from('0a0b0c', 'hex'),
    inOut: Buffer.from('aabb', 'hex'),
    output: Buffer.from('0a0b0c', 'hex'),
    returnedInOut: Buffer.from('aabbff', 'hex'),
  },
];

/** Every procedure of the types package: the scalar echoes, then the serializer and cursor reads. */
const typesPackageProcedures: ReadonlyArray<IPlsqlProcedure> = [
  ...scalarEchoCases.map(
    ({ type, procedure, declarations, statements }): IPlsqlProcedure => ({
      name: procedure.toUpperCase(),
      parameters: `P_INPUT IN ${type}, P_OUTPUT OUT ${type}, P_IN_OUT IN OUT ${type}`,
      declarations,
      statements,
    })
  ),
  {
    name: 'READ_SCALARS',
    parameters:
      'OUT_RAW OUT RAW, OUT_BLOB OUT BLOB, OUT_FLAG OUT BOOLEAN, OUT_CODE OUT CHAR, OUT_NAME OUT VARCHAR2',
    declarations: '',
    statements: [
      "OUT_RAW := HEXTORAW('CAFE');",
      'DBMS_LOB.CREATETEMPORARY(OUT_BLOB, TRUE);',
      "DBMS_LOB.WRITEAPPEND(OUT_BLOB, 2, HEXTORAW('BEEF'));",
      'OUT_FLAG := TRUE;',
      "OUT_CODE := 'Y';",
      "OUT_NAME := 'scalar';",
    ].join(' '),
  },
  {
    name: 'READ_NATIONAL_SCALARS',
    parameters: 'OUT_NCODE OUT NCHAR, OUT_NNAME OUT NVARCHAR2',
    declarations: '',
    statements: "OUT_NCODE := N'Ж'; OUT_NNAME := N'ёлка';",
  },
  {
    name: 'OPEN_ROWS',
    parameters: 'OUT_ROWS OUT SYS_REFCURSOR',
    declarations: '',
    statements: `OPEN OUT_ROWS FOR ${selectRowsSql};`,
  },
];

/** The all-NULL row: a nullish value bypasses every strategy and comes back as `null`. */
const nullRow = {
  id: 2,
  raw_value: null,
  blob_value: null,
  clob_value: null,
  char_value: null,
  nchar_value: null,
  varchar_value: null,
  nvarchar_value: null,
  flag_value: null,
};

/** The table rows as the driver returns them while no serializer is registered. */
const nativeRows = [
  {
    id: 1,
    raw_value: Buffer.from('cafebabe', 'hex'),
    blob_value: Buffer.from('0102030405', 'hex'),
    clob_value: 'clob-value',
    char_value: 'ABCD',
    nchar_value: 'ЖЖЖЖ',
    varchar_value: 'plain',
    nvarchar_value: 'ёлка',
    flag_value: true,
  },
  nullRow,
];

/**
 * Builds the value a label strategy returns for one call.
 * @param label - the label the strategy derives from the value.
 * @param source - runtime path that supplied the value.
 * @param name - result column or output-bind name after the case strategy.
 * @param databaseType - native type name the kit passes in the context.
 * @returns the expected strategy result.
 */
function labelled(
  label: string,
  source: TLabelSource,
  name: string,
  databaseType: string
): ILabelledValue {
  return {
    label,
    context: { source, database: 'oracle', name, databaseType },
  };
}

/**
 * The table rows once the label strategies are registered. The NCHAR and NVARCHAR2 columns stay
 * native: the fetch handler maps the CHAR and VARCHAR strategies onto `DB_TYPE_CHAR` and
 * `DB_TYPE_VARCHAR` only (characterizing).
 */
const labelledRows = [
  {
    id: 1,
    raw_value: labelled('bin:cafebabe', 'fetch', 'raw_value', 'RAW'),
    blob_value: labelled('bin:0102030405', 'fetch', 'blob_value', 'BLOB'),
    clob_value: 'clob-value',
    char_value: labelled('char:ABCD', 'fetch', 'char_value', 'CHAR'),
    nchar_value: 'ЖЖЖЖ',
    varchar_value: labelled(
      'varchar:plain',
      'fetch',
      'varchar_value',
      'VARCHAR2'
    ),
    nvarchar_value: 'ёлка',
    flag_value: labelled('bool:true', 'fetch', 'flag_value', 'BOOLEAN'),
  },
  nullRow,
];

/**
 * Returns the Oracle settings inside the suite, which runs only when they exist.
 * @returns the Oracle integration settings.
 */
function requireSettings(): TOracleIntegrationSettings {
  if (!settings) throw new Error('Oracle integration settings are missing');
  return settings;
}

/**
 * Runs a DROP statement and ignores only the error Oracle raises when the object is missing.
 * @param connection - standalone connection to run the statement on.
 * @param statement - the DROP statement, without quotes or a semicolon.
 * @param missingObjectCode - SQLCODE of the missing-object error.
 */
async function dropIfExists(
  connection: oracledb.Connection,
  statement: string,
  missingObjectCode: number
): Promise<void> {
  await connection.execute(`
    BEGIN
      EXECUTE IMMEDIATE '${statement}';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != ${missingObjectCode} THEN
          RAISE;
        END IF;
    END;
  `);
}

/**
 * Drops every object this file creates.
 * @param connection - standalone connection to run the statements on.
 */
async function dropFixtures(connection: oracledb.Connection): Promise<void> {
  await dropIfExists(
    connection,
    `DROP PACKAGE ${jsonPackageName}`,
    missingPackageCode
  );
  await dropIfExists(
    connection,
    `DROP PACKAGE ${typesPackageName}`,
    missingPackageCode
  );
  await dropIfExists(
    connection,
    `DROP TABLE ${rowsTableName} PURGE`,
    missingTableCode
  );
}

/**
 * Reads the compilation errors of a stored object. node-oracledb does not fail a `CREATE PACKAGE`
 * that compiles with errors, so the fixtures check this list instead.
 * @param connection - standalone connection to run the query on.
 * @param objectName - object name in upper case.
 * @returns one entry per error, empty when the object compiled.
 */
async function readCompilationErrors(
  connection: oracledb.Connection,
  objectName: string
): Promise<Array<Record<string, unknown>>> {
  const result = await connection.execute<Record<string, unknown>>(
    `SELECT TYPE AS "type", LINE AS "line", POSITION AS "position", TEXT AS "text"
       FROM USER_ERRORS
      WHERE NAME = :OBJECT_NAME
        AND ATTRIBUTE = 'ERROR'
      ORDER BY TYPE, SEQUENCE`,
    { OBJECT_NAME: objectName },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return result.rows ?? [];
}

/**
 * Creates a package from its procedures and checks that both parts compiled.
 * @param connection - standalone connection to run the statements on.
 * @param packageName - package name in upper case.
 * @param procedures - procedures the spec declares and the body implements.
 */
async function createPackage(
  connection: oracledb.Connection,
  packageName: string,
  procedures: ReadonlyArray<IPlsqlProcedure>
): Promise<void> {
  const specLines = procedures.map(
    ({ name, parameters }): string => `PROCEDURE ${name}(${parameters});`
  );
  const bodyLines = procedures.map(
    ({ name, parameters, declarations, statements }): string =>
      `PROCEDURE ${name}(${parameters}) AS ${declarations} BEGIN ${statements} END ${name};`
  );
  await connection.execute(
    `CREATE OR REPLACE PACKAGE ${packageName} AS\n  ${specLines.join('\n  ')}\nEND ${packageName};`
  );
  await connection.execute(
    `CREATE OR REPLACE PACKAGE BODY ${packageName} AS\n  ${bodyLines.join('\n  ')}\nEND ${packageName};`
  );
  expect(await readCompilationErrors(connection, packageName)).toEqual([]);
}

/**
 * Creates the table with one row of every column type and one all-NULL row, then the types
 * package, whose cursor reads that table.
 * @param connection - standalone connection to run the statements on.
 */
async function createFixtures(connection: oracledb.Connection): Promise<void> {
  await connection.execute(`
    CREATE TABLE ${rowsTableName} (
      ID NUMBER(10) PRIMARY KEY,
      RAW_VALUE RAW(16),
      BLOB_VALUE BLOB,
      CLOB_VALUE CLOB,
      CHAR_VALUE CHAR(4),
      NCHAR_VALUE NCHAR(4),
      VARCHAR_VALUE VARCHAR2(40),
      NVARCHAR_VALUE NVARCHAR2(40),
      FLAG_VALUE BOOLEAN
    )
  `);
  await connection.execute(`
    INSERT INTO ${rowsTableName} (${rowColumns})
    VALUES (
      1,
      HEXTORAW('CAFEBABE'),
      HEXTORAW('0102030405'),
      'clob-value',
      'ABCD',
      N'ЖЖЖЖ',
      'plain',
      N'ёлка',
      TRUE
    )
  `);
  await connection.execute(`INSERT INTO ${rowsTableName} (ID) VALUES (2)`);
  await connection.commit();
  await createPackage(connection, typesPackageName, typesPackageProcedures);
}

/**
 * Builds the kit config overrides that load every procedure of the types package.
 * @returns config fields spread over the integration settings.
 */
function createTypesKitConfig(): Partial<TOracleDbConfig> {
  const procedures = typesPackageProcedures.map(({ name }): string =>
    name.toLowerCase()
  );
  return {
    packagesSettings: {
      packages: [typesPackage],
      procedureObjectList: Object.fromEntries(
        procedures.map((procedure): [string, string] => [
          procedure,
          `${typesPackage}.${procedure}`,
        ])
      ),
    },
  };
}

/**
 * Renders a BINARY value as hexadecimal text.
 * @param value - the native value the strategy received.
 * @returns the bytes in hexadecimal, or the string itself.
 */
function toHex(value: string | Buffer | ArrayBuffer): string {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value)
    ? value.toString('hex')
    : Buffer.from(value).toString('hex');
}

/**
 * Renders a CHAR or VARCHAR value as text.
 * @param value - the native value the strategy received.
 * @returns the text.
 */
function toText(value: string | Buffer): string {
  return typeof value === 'string' ? value : value.toString('utf8');
}

/**
 * Registers BINARY, BOOLEAN, CHAR and VARCHAR strategies that return a label of the value
 * together with the context they were called with. The CHAR label drops trailing blanks, so it
 * shows where the value was routed whether or not the server pads a CHAR.
 * @param kit - an initialized kit.
 */
function registerLabelSerializers(kit: TypeOrmProcedureKit): void {
  kit.setSerializer({
    serializerType: 'BINARY',
    strategy: ({ value, context }): ILabelledValue => ({
      label: `bin:${toHex(value)}`,
      context,
    }),
  });
  kit.setSerializer({
    serializerType: 'BOOLEAN',
    strategy: ({ value, context }): ILabelledValue => ({
      label: `bool:${String(value)}`,
      context,
    }),
  });
  kit.setSerializer({
    serializerType: 'CHAR',
    strategy: ({ value, context }): ILabelledValue => ({
      label: `char:${toText(value).trimEnd()}`,
      context,
    }),
  });
  kit.setSerializer({
    serializerType: 'VARCHAR',
    strategy: ({ value, context }): ILabelledValue => ({
      label: `varchar:${toText(value)}`,
      context,
    }),
  });
}

describe.skipIf(!settings)(
  'Oracle types, serializers and LOB integration',
  (): void => {
    beforeAll(async (): Promise<void> => {
      const integrationSettings = requireSettings();
      ensureOracleClientMode(integrationSettings);
      await withOracleConnection(
        integrationSettings,
        async (connection): Promise<void> => {
          await dropFixtures(connection);
          await createFixtures(connection);
        }
      );
    }, hookTimeoutMs);

    afterAll(async (): Promise<void> => {
      await withOracleConnection(
        requireSettings(),
        (connection): Promise<void> => dropFixtures(connection)
      );
    }, hookTimeoutMs);

    it.each(scalarEchoCases)(
      'binds $type IN, OUT and IN OUT arguments',
      async ({
        procedure,
        input,
        inOut,
        output,
        returnedInOut,
      }): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            await expect(
              kit.call(`${typesPackage}.${procedure}`, {
                input,
                in_out: inOut,
              })
            ).resolves.toEqual({
              rows: [],
              outBinds: { p_output: output, p_in_out: returnedInOut },
            });
          }
        );
      },
      testTimeoutMs
    );

    it(
      'rejects a JSON argument by its dictionary type before calling the procedure',
      async (): Promise<void> => {
        const integrationSettings = requireSettings();
        try {
          await withOracleConnection(
            integrationSettings,
            (connection): Promise<void> =>
              createPackage(connection, jsonPackageName, [
                {
                  name: 'ECHO_JSON',
                  parameters: 'P_DOC IN JSON, P_TEXT OUT VARCHAR2',
                  declarations: '',
                  statements: "P_TEXT := 'unreachable';",
                },
              ])
          );
          await withKit(
            integrationSettings,
            {
              packagesSettings: {
                packages: [jsonPackage],
                procedureObjectList: { echoJson: `${jsonPackage}.echo_json` },
              },
            },
            async (kit): Promise<void> => {
              await expect(
                kit.call(`${jsonPackage}.echo_json`, { doc: { id: 1 } })
              ).rejects.toThrow('Invalid data type: JSON');
            }
          );
        } finally {
          await withOracleConnection(
            integrationSettings,
            (connection): Promise<void> =>
              dropIfExists(
                connection,
                `DROP PACKAGE ${jsonPackageName}`,
                missingPackageCode
              )
          );
        }
      },
      testTimeoutMs
    );

    it(
      'labels RAW, BLOB, CHAR, VARCHAR2 and BOOLEAN columns of a direct query as fetch values',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            registerLabelSerializers(kit);
            await expect(
              kit.callSqlTransaction(selectRowsSql)
            ).resolves.toEqual(labelledRows);
          }
        );
      },
      testTimeoutMs
    );

    it(
      'labels the same columns of a REF CURSOR as fetch values',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            registerLabelSerializers(kit);
            await expect(
              kit.call(`${typesPackage}.open_rows`)
            ).resolves.toEqual({
              rows: labelledRows,
              outBinds: { out_rows: labelledRows },
            });
          }
        );
      },
      testTimeoutMs
    );

    it(
      'labels RAW, BLOB, BOOLEAN, CHAR and VARCHAR2 OUT values as scalar-out values',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            registerLabelSerializers(kit);
            await expect(
              kit.call(`${typesPackage}.read_scalars`)
            ).resolves.toEqual({
              rows: [],
              outBinds: {
                out_raw: labelled('bin:cafe', 'scalar-out', 'out_raw', 'RAW'),
                out_blob: labelled(
                  'bin:beef',
                  'scalar-out',
                  'out_blob',
                  'BLOB'
                ),
                out_flag: labelled(
                  'bool:true',
                  'scalar-out',
                  'out_flag',
                  'BOOLEAN'
                ),
                out_code: labelled('char:Y', 'scalar-out', 'out_code', 'CHAR'),
                out_name: labelled(
                  'varchar:scalar',
                  'scalar-out',
                  'out_name',
                  'VARCHAR2'
                ),
              },
            });
          }
        );
      },
      testTimeoutMs
    );

    it(
      'labels NCHAR and NVARCHAR2 OUT values with the CHAR and VARCHAR strategies',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            registerLabelSerializers(kit);
            await expect(
              kit.call(`${typesPackage}.read_national_scalars`)
            ).resolves.toEqual({
              rows: [],
              outBinds: {
                out_ncode: labelled(
                  'char:Ж',
                  'scalar-out',
                  'out_ncode',
                  'NCHAR'
                ),
                out_nname: labelled(
                  'varchar:ёлка',
                  'scalar-out',
                  'out_nname',
                  'NVARCHAR2'
                ),
              },
            });
          }
        );
      },
      testTimeoutMs
    );

    it(
      'returns BLOB columns of a direct query as Buffers and CLOB columns as strings without a BINARY serializer',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            await expect(
              kit.callSqlTransaction(selectRowsSql)
            ).resolves.toEqual(nativeRows);
          }
        );
      },
      testTimeoutMs
    );

    it(
      'returns BLOB columns of a REF CURSOR as Buffers and CLOB columns as strings without a BINARY serializer',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            await expect(
              kit.call(`${typesPackage}.open_rows`)
            ).resolves.toEqual({
              rows: nativeRows,
              outBinds: { out_rows: nativeRows },
            });
          }
        );
      },
      testTimeoutMs
    );

    /**
     * The shifted text puts every surrogate pair across an odd offset, so a LOB read in pieces of
     * an even number of code units splits pairs at the piece boundaries.
     */
    it.each<IClobTextCase>([
      { shape: 'aligned to the pairs', text: emojiText },
      { shape: 'shifted by one code unit', text: `a${emojiText}` },
    ])(
      'returns 20 000 emoji through a CLOB OUT unchanged, $shape',
      async ({ text }): Promise<void> => {
        await withKit(
          requireSettings(),
          createTypesKitConfig(),
          async (kit): Promise<void> => {
            await expect(
              kit.call(`${typesPackage}.echo_clob`, {
                input: text,
                in_out: 'tail',
              })
            ).resolves.toEqual({
              rows: [],
              outBinds: { p_output: text, p_in_out: 'tail-io' },
            });
          }
        );
      },
      testTimeoutMs
    );

    it(
      'rejects a CLOB OUT larger than resourceLimits.maxLobBytes',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          { ...createTypesKitConfig(), resourceLimits: { maxLobBytes: 1024 } },
          async (kit): Promise<void> => {
            await expect(
              kit.call(`${typesPackage}.echo_clob`, {
                input: 'x'.repeat(2048),
                in_out: 'tail',
              })
            ).rejects.toThrow(
              'Oracle LOB exceeds resourceLimits.maxLobBytes (1024)'
            );
          }
        );
      },
      testTimeoutMs
    );

    /** Characterizing: the driver reads a fetched CLOB column as a string, past the LOB limit. */
    it(
      'returns a fetched CLOB column larger than resourceLimits.maxLobBytes whole',
      async (): Promise<void> => {
        await withKit(
          requireSettings(),
          { ...createTypesKitConfig(), resourceLimits: { maxLobBytes: 1024 } },
          async (kit): Promise<void> => {
            await expect(
              kit.callSqlTransaction(
                "SELECT TO_CLOB(RPAD('x', 2048, 'x')) AS big_clob FROM dual"
              )
            ).resolves.toEqual([{ big_clob: 'x'.repeat(2048) }]);
          }
        );
      },
      testTimeoutMs
    );
  }
);
