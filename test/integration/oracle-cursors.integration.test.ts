import oracledb from 'oracledb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DateFormatter } from '../../src/index.js';

import {
  createOracleIntegrationSettings,
  ensureOracleClientMode,
  withKit,
  withOracleConnection,
} from './database-integration.helpers.js';

import type {
  ISerializerContext,
  TOracleDbConfig,
  TSetSerializer,
  TypeOrmProcedureKit,
} from '../../src/index.js';

const settings = createOracleIntegrationSettings();
const cursorPackage = 'tpk_it_cursor_pkg' as const;
const cursorPackageName = cursorPackage.toUpperCase();
/** Generous per-test budget: every case opens its own kit and pool on a shared CI database. */
const testTimeoutMs = 60_000;

type TOracleIntegrationSettings = NonNullable<
  ReturnType<typeof createOracleIntegrationSettings>
>;

/** One row of the `ORDER_ROWS` SELECT after the camelCase strategy and the DATE probe. */
interface IOrderRow {
  orderId: number;
  aBC: string;
  createdAt: string;
}

/** What the DATE strategy received on one call. */
interface IDateStrategyCall {
  valueType: string;
  context: ISerializerContext | undefined;
}

/** A DATE serializer that records every call it receives. */
interface IDateSerializerProbe {
  serializer: TSetSerializer<'DATE'>;
  calls: Array<IDateStrategyCall>;
}

/** The record the probe keeps for a `CREATED_AT` value fetched from a rowset. */
const createdAtFetchCall: IDateStrategyCall = {
  valueType: 'Date',
  context: {
    source: 'fetch',
    database: 'oracle',
    name: 'createdAt',
    databaseType: 'DATE',
  },
};

/**
 * Returns the Oracle settings inside the suite, which runs only when they exist.
 * @returns the Oracle integration settings.
 */
function requireSettings(): TOracleIntegrationSettings {
  if (!settings) throw new Error('Oracle integration settings are missing');
  return settings;
}

/**
 * Builds the SELECT that both the `ORDER_ROWS` cursor and the plain query run, so the two paths
 * fetch the same columns: `ORDER_ID` (NUMBER), `A_B_C` (VARCHAR2) and `CREATED_AT` (DATE), one row
 * per day from 2026-07-16 12:30:45 on.
 * @param rowCountExpression - the PL/SQL argument or the raw SQL placeholder holding the row count.
 * @returns the SELECT statement, without a trailing semicolon.
 */
function buildOrderRowsSelect(rowCountExpression: string): string {
  return `
    SELECT
      LEVEL AS ORDER_ID,
      'row-' || LEVEL AS A_B_C,
      TO_DATE('2026-07-16 12:30:45', 'YYYY-MM-DD HH24:MI:SS') + (LEVEL - 1) AS CREATED_AT
    FROM dual
    CONNECT BY LEVEL <= ${rowCountExpression}
    ORDER BY ORDER_ID`;
}

/**
 * Lists the rows `buildOrderRowsSelect` returns for `count` rows (up to 15, all in July 2026).
 * @param count - number of rows the SELECT was asked for.
 * @returns the rows under camelCase keys, with the DATE probe's output in `createdAt`.
 */
function expectedOrderRows(count: number): Array<IOrderRow> {
  return Array.from(
    { length: count },
    (_, index): IOrderRow => ({
      orderId: index + 1,
      aBC: `row-${index + 1}`,
      createdAt: `date:2026-07-${16 + index} 12:30:45`,
    })
  );
}

/**
 * Creates a DATE serializer that records the native value type and the context of every call,
 * and returns `date:` followed by the value in the default DATE format.
 * @returns the serializer and the list its strategy appends to.
 */
function createDateSerializerProbe(): IDateSerializerProbe {
  const calls: Array<IDateStrategyCall> = [];
  return {
    calls,
    serializer: {
      serializerType: 'DATE',
      strategy: ({ value, context }): string => {
        calls.push({
          valueType: value instanceof Date ? 'Date' : typeof value,
          context,
        });
        return `date:${DateFormatter.formatDefaultDate(value)}`;
      },
    },
  };
}

/**
 * Runs a DDL statement and fails when it leaves the cursor package with compilation errors,
 * which node-oracledb reports as a warning rather than as an exception.
 * @param connection - standalone connection of the fixture.
 * @param ddl - the statement to run.
 */
async function executeFixtureDdl(
  connection: oracledb.Connection,
  ddl: string
): Promise<void> {
  const result = await connection.execute(ddl);
  if (result.warning === undefined) return;
  const compileErrors = await connection.execute<{
    type: string;
    line: number;
    position: number;
    text: string;
  }>(
    `SELECT TYPE AS "type", LINE AS "line", POSITION AS "position", TEXT AS "text"
       FROM USER_ERRORS
      WHERE NAME = '${cursorPackageName}'
        AND ATTRIBUTE = 'ERROR'
      ORDER BY TYPE, SEQUENCE`,
    [],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const errors = compileErrors.rows ?? [];
  if (errors.length === 0) return;
  throw new Error(
    `${cursorPackageName} did not compile (${result.warning.message}): ${JSON.stringify(errors)}`
  );
}

/**
 * Drops the cursor package, ignoring ORA-04043 when it does not exist.
 * @param integrationSettings - Oracle integration settings.
 */
async function dropCursorPackage(
  integrationSettings: TOracleIntegrationSettings
): Promise<void> {
  await withOracleConnection(
    integrationSettings,
    async (connection): Promise<void> => {
      await connection.execute(`
        BEGIN
          EXECUTE IMMEDIATE 'DROP PACKAGE ${cursorPackageName}';
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE != -4043 THEN
              RAISE;
            END IF;
        END;
      `);
    }
  );
}

/**
 * Recreates the cursor package from scratch.
 * @param integrationSettings - Oracle integration settings.
 */
async function createCursorPackage(
  integrationSettings: TOracleIntegrationSettings
): Promise<void> {
  await dropCursorPackage(integrationSettings);
  await withOracleConnection(
    integrationSettings,
    async (connection): Promise<void> => {
      await executeFixtureDdl(
        connection,
        `
        CREATE OR REPLACE PACKAGE ${cursorPackageName} AS
          PROCEDURE ORDER_ROWS(
            P_ROW_COUNT IN NUMBER,
            OUT_ORDERS OUT SYS_REFCURSOR
          );
          PROCEDURE TWO_CURSORS(
            OUT_FIRST OUT SYS_REFCURSOR,
            OUT_TOTAL OUT NUMBER,
            OUT_SECOND OUT SYS_REFCURSOR
          );
          PROCEDURE CLOB_ROWS(
            OUT_NOTES OUT SYS_REFCURSOR
          );
        END ${cursorPackageName};
      `
      );
      await executeFixtureDdl(
        connection,
        `
        CREATE OR REPLACE PACKAGE BODY ${cursorPackageName} AS
          PROCEDURE ORDER_ROWS(
            P_ROW_COUNT IN NUMBER,
            OUT_ORDERS OUT SYS_REFCURSOR
          ) AS
          BEGIN
            OPEN OUT_ORDERS FOR ${buildOrderRowsSelect('P_ROW_COUNT')};
          END ORDER_ROWS;
          PROCEDURE TWO_CURSORS(
            OUT_FIRST OUT SYS_REFCURSOR,
            OUT_TOTAL OUT NUMBER,
            OUT_SECOND OUT SYS_REFCURSOR
          ) AS
          BEGIN
            OPEN OUT_FIRST FOR
              SELECT 1 AS ORDER_ID, 'first' AS A_B_C FROM dual;
            OUT_TOTAL := 3;
            OPEN OUT_SECOND FOR
              SELECT LEVEL + 1 AS ORDER_ID, 'second' AS A_B_C
              FROM dual
              CONNECT BY LEVEL <= 2
              ORDER BY ORDER_ID;
          END TWO_CURSORS;
          PROCEDURE CLOB_ROWS(
            OUT_NOTES OUT SYS_REFCURSOR
          ) AS
          BEGIN
            OPEN OUT_NOTES FOR
              SELECT
                1 AS ORDER_ID,
                TO_CLOB(RPAD('x', 4000, 'x')) || TO_CLOB(RPAD('y', 4000, 'y'))
                  AS NOTE_TEXT
              FROM dual
              UNION ALL
              SELECT 2 AS ORDER_ID, CAST(NULL AS CLOB) AS NOTE_TEXT FROM dual
              ORDER BY ORDER_ID;
          END CLOB_ROWS;
        END ${cursorPackageName};
      `
      );
    }
  );
}

/**
 * Runs the callback on a kit with camelCase output keys, the cursor package configured and a
 * fresh DATE probe registered after `initDatabase()`; the kit is destroyed afterwards.
 * @param configOverrides - config fields that replace the suite defaults.
 * @param callback - work to run on the kit, given the probe registered on it.
 * @returns the callback result.
 */
async function withCursorKit<TResult>(
  configOverrides: Partial<TOracleDbConfig>,
  callback: (
    kit: TypeOrmProcedureKit,
    probe: IDateSerializerProbe
  ) => Promise<TResult>
): Promise<TResult> {
  return withKit(
    requireSettings(),
    {
      outKeyTransformCase: 'camelCase',
      packagesSettings: {
        packages: [cursorPackage],
        procedureObjectList: {
          orderRows: `${cursorPackage}.order_rows`,
          twoCursors: `${cursorPackage}.two_cursors`,
          clobRows: `${cursorPackage}.clob_rows`,
        },
      },
      ...configOverrides,
    },
    async (kit): Promise<TResult> => {
      const probe = createDateSerializerProbe();
      kit.setSerializer(probe.serializer);
      return callback(kit, probe);
    }
  );
}

describe.skipIf(!settings)('Oracle cursors and case strategy', (): void => {
  beforeAll(async (): Promise<void> => {
    const integrationSettings = requireSettings();
    // Thick mode must be selected before the first standalone connection.
    ensureOracleClientMode(integrationSettings);
    await createCursorPackage(integrationSettings);
  }, testTimeoutMs);

  afterAll(async (): Promise<void> => {
    await dropCursorPackage(requireSettings());
  }, testTimeoutMs);

  it(
    'names OUT REF CURSOR columns once and runs the DATE strategy once per row',
    async (): Promise<void> => {
      await withCursorKit({}, async (kit, probe): Promise<void> => {
        const rows: Array<IOrderRow> = [
          { orderId: 1, aBC: 'row-1', createdAt: 'date:2026-07-16 12:30:45' },
          { orderId: 2, aBC: 'row-2', createdAt: 'date:2026-07-17 12:30:45' },
          { orderId: 3, aBC: 'row-3', createdAt: 'date:2026-07-18 12:30:45' },
        ];

        await expect(
          kit.call(`${cursorPackage}.order_rows`, { row_count: 3 })
        ).resolves.toEqual({ rows, outBinds: { outOrders: rows } });
        expect(probe.calls).toEqual([
          createdAtFetchCall,
          createdAtFetchCall,
          createdAtFetchCall,
        ]);
      });
    },
    testTimeoutMs
  );

  it(
    'names the same SELECT run through callSqlTransaction as the cursor names it',
    async (): Promise<void> => {
      await withCursorKit({}, async (kit, probe): Promise<void> => {
        await expect(
          kit.callSqlTransaction(buildOrderRowsSelect(':ROW_COUNT'), {
            row_count: 3,
          })
        ).resolves.toEqual([
          { orderId: 1, aBC: 'row-1', createdAt: 'date:2026-07-16 12:30:45' },
          { orderId: 2, aBC: 'row-2', createdAt: 'date:2026-07-17 12:30:45' },
          { orderId: 3, aBC: 'row-3', createdAt: 'date:2026-07-18 12:30:45' },
        ]);
        expect(probe.calls).toEqual([
          createdAtFetchCall,
          createdAtFetchCall,
          createdAtFetchCall,
        ]);
      });
    },
    testTimeoutMs
  );

  it(
    'concatenates two cursors into rows and keeps every OUT value under its own key',
    async (): Promise<void> => {
      await withCursorKit({}, async (kit): Promise<void> => {
        await expect(kit.call(`${cursorPackage}.two_cursors`)).resolves.toEqual(
          {
            rows: [
              { orderId: 1, aBC: 'first' },
              { orderId: 2, aBC: 'second' },
              { orderId: 3, aBC: 'second' },
            ],
            outBinds: {
              outFirst: [{ orderId: 1, aBC: 'first' }],
              outTotal: 3,
              outSecond: [
                { orderId: 2, aBC: 'second' },
                { orderId: 3, aBC: 'second' },
              ],
            },
          }
        );
      });
    },
    testTimeoutMs
  );

  it(
    'returns a CLOB column of a cursor as a string',
    async (): Promise<void> => {
      await withCursorKit({}, async (kit): Promise<void> => {
        const noteRows = [
          {
            orderId: 1,
            noteText: `${'x'.repeat(4000)}${'y'.repeat(4000)}`,
          },
          { orderId: 2, noteText: null },
        ];

        await expect(kit.call(`${cursorPackage}.clob_rows`)).resolves.toEqual({
          rows: noteRows,
          outBinds: { outNotes: noteRows },
        });
      });
    },
    testTimeoutMs
  );

  it(
    'rejects a cursor one row above resourceLimits.maxProcedureRows',
    async (): Promise<void> => {
      await withCursorKit(
        { resourceLimits: { maxProcedureRows: 5 } },
        async (kit): Promise<void> => {
          await expect(
            kit.call(`${cursorPackage}.order_rows`, { row_count: 5 })
          ).resolves.toEqual({
            rows: expectedOrderRows(5),
            outBinds: { outOrders: expectedOrderRows(5) },
          });
          await expect(
            kit.call(`${cursorPackage}.order_rows`, { row_count: 6 })
          ).rejects.toThrow(
            'Oracle procedure result exceeds resourceLimits.maxProcedureRows (5)'
          );
        }
      );
    },
    testTimeoutMs
  );
});
