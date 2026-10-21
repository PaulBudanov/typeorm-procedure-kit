import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ServerError } from '../../src/index.js';
import { createLogger } from '../support/helpers.js';

import {
  createOracleIntegrationSettings,
  ensureOracleClientMode,
  withKit,
  withOracleConnection,
} from './database-integration.helpers.js';

import type { TypeOrmProcedureKit } from '../../src/index.js';
import type { ITestLogger } from '../support/helpers.js';

/** Generous per-case budget: every case opens its own kit and pool on a shared CI database. */
const TEST_TIMEOUT_MS = 60_000;
const settings = createOracleIntegrationSettings();
const FIXTURE_PACKAGE = 'tpk_it_scope_pkg' as const;
const DUPLICATE_CURSOR_PROCEDURE = `${FIXTURE_PACKAGE}.duplicate_cursor`;

/** Two columns under one raw name, `ID`, both mapped onto `id` by the `lowerCase` strategy. */
const DUPLICATE_NAME_SQL = 'SELECT 1 AS id, 2 AS id FROM dual';
const DUPLICATE_NAME_COLLISION =
  'Oracle result columns "ID" and "ID" have conflicting transformed name "id"';
/** Two distinct raw names that only meet after the `camelCase` strategy. */
const CASE_STRATEGY_SQL = 'SELECT 1 AS COL_2, 2 AS "col2" FROM dual';
const CASE_STRATEGY_COLLISION =
  'Oracle result columns "COL_2" and "col2" have conflicting transformed name "col2"';

type TRawQueryRunner = (
  kit: TypeOrmProcedureKit,
  sql: string
) => Promise<unknown>;

/**
 * The two ways a consumer runs raw SQL on the kit's pool outside a kit call. Neither goes through
 * `ExecuteBase`, so neither carries the kit-call mark.
 *
 * Every case builds a kit of its own, so each SQL text runs once per pool: in Thin mode a
 * statement cached on a connection is not described again, and its second execution would hand
 * the fetch type handler the names the first execution already renamed.
 */
const rawQueryRunners: Array<[label: string, runQuery: TRawQueryRunner]> = [
  [
    'kit.dataSource.query()',
    (kit: TypeOrmProcedureKit, sql: string): Promise<unknown> =>
      kit.dataSource.query(sql),
  ],
  [
    'an entity manager from getEntityManager()',
    async (kit: TypeOrmProcedureKit, sql: string): Promise<unknown> => {
      const manager = await kit.getEntityManager();
      try {
        return await manager.query(sql);
      } finally {
        await kit.releaseEntityManager(manager);
      }
    },
  ],
];

/**
 * Drops the fixture package; a missing package (ORA-04043) is not an error.
 * @param integrationSettings - Oracle integration settings.
 */
async function dropFixture(
  integrationSettings: NonNullable<typeof settings>
): Promise<void> {
  await withOracleConnection(
    integrationSettings,
    async (connection): Promise<void> => {
      await connection.execute(`
        BEGIN
          EXECUTE IMMEDIATE 'DROP PACKAGE ${FIXTURE_PACKAGE.toUpperCase()}';
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
 * Creates the fixture package: one procedure whose OUT cursor returns two columns called `ID`.
 * The cursor is opened on a dynamic statement, so the duplicate alias is resolved by the SQL
 * engine at run time rather than by the PL/SQL compiler.
 * @param integrationSettings - Oracle integration settings.
 */
async function createFixture(
  integrationSettings: NonNullable<typeof settings>
): Promise<void> {
  await dropFixture(integrationSettings);
  await withOracleConnection(
    integrationSettings,
    async (connection): Promise<void> => {
      await connection.execute(`
        CREATE OR REPLACE PACKAGE ${FIXTURE_PACKAGE.toUpperCase()} AS
          PROCEDURE DUPLICATE_CURSOR(OUT_CURSOR OUT SYS_REFCURSOR);
        END ${FIXTURE_PACKAGE.toUpperCase()};
      `);
      await connection.execute(`
        CREATE OR REPLACE PACKAGE BODY ${FIXTURE_PACKAGE.toUpperCase()} AS
          PROCEDURE DUPLICATE_CURSOR(OUT_CURSOR OUT SYS_REFCURSOR) AS
          BEGIN
            OPEN OUT_CURSOR FOR 'SELECT 1 AS id, 2 AS id FROM dual';
          END DUPLICATE_CURSOR;
        END ${FIXTURE_PACKAGE.toUpperCase()};
      `);
    }
  );
}

/**
 * Asserts that a kit call failed on the column collision itself. The fetch type handler raises
 * the collision inside node-oracledb's `execute()`; the query runner wraps it in a
 * `QueryFailedError` and the kit turns that into a `ServerError` carrying the wrapper's message,
 * hence the `ServerError: ` prefix.
 * @param pending - the kit call.
 * @param collision - the collision text the fetch type handler raised.
 */
async function expectKitCallRejected(
  pending: Promise<unknown>,
  collision: string
): Promise<void> {
  await expect(pending).rejects.toBeInstanceOf(ServerError);
  await expect(pending).rejects.toMatchObject({
    message: `ServerError: ${collision}`,
  });
}

/**
 * Builds the settings of one case: the shared integration settings with a logger of its own, so
 * that the warnings a case asserts on are only the ones it caused.
 * @param logger - the case's logger.
 * @returns the settings to build the case's kit from.
 */
function withCaseLogger(logger: ITestLogger): NonNullable<typeof settings> {
  return { ...settings!, logger: { module: logger } };
}

/**
 * Picks the column collision warnings out of everything the case logged as a warning, so that an
 * unrelated warning, such as a slow-query report on a busy runner, does not count.
 * @param logger - the case's logger.
 * @returns the messages of the collision warnings, in the order they were logged.
 */
function collisionWarnings(logger: ITestLogger): Array<unknown> {
  return logger.warn.mock.calls
    .map(([message]): unknown => message)
    .filter(
      (message): boolean =>
        typeof message === 'string' &&
        message.startsWith('Oracle result columns ') &&
        message.includes(' have conflicting transformed name ')
    );
}

describe.skipIf(!settings)(
  'Oracle duplicate result columns by call site',
  (): void => {
    beforeAll(async (): Promise<void> => {
      // Thick mode, when configured, has to be chosen before the first connection of the file.
      ensureOracleClientMode(settings!);
      await createFixture(settings!);
    }, TEST_TIMEOUT_MS);

    afterAll(async (): Promise<void> => {
      await dropFixture(settings!);
    }, TEST_TIMEOUT_MS);

    it(
      'rejects a callSqlTransaction() whose columns share a name',
      async (): Promise<void> => {
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          {},
          async (kit): Promise<void> => {
            await expectKitCallRejected(
              kit.callSqlTransaction(DUPLICATE_NAME_SQL),
              DUPLICATE_NAME_COLLISION
            );
          }
        );
        expect(collisionWarnings(logger)).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it.each(rawQueryRunners)(
      'returns the rows of that SQL through %s, the driver suffixing the repeated name, and warns once',
      async (_label, runQuery): Promise<void> => {
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          {},
          async (kit): Promise<void> => {
            await expect(runQuery(kit, DUPLICATE_NAME_SQL)).resolves.toEqual([
              { id: 1, id_1: 2 },
            ]);
          }
        );
        expect(collisionWarnings(logger)).toEqual([DUPLICATE_NAME_COLLISION]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'rejects a callSqlTransaction() whose columns collide after the case strategy',
      async (): Promise<void> => {
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          { outKeyTransformCase: 'camelCase' },
          async (kit): Promise<void> => {
            await expectKitCallRejected(
              kit.callSqlTransaction(CASE_STRATEGY_SQL),
              CASE_STRATEGY_COLLISION
            );
          }
        );
        expect(collisionWarnings(logger)).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it.each(rawQueryRunners)(
      'returns the rows of the case-strategy collision through %s, the earlier column taking the suffix, and warns once',
      async (_label, runQuery): Promise<void> => {
        // node-oracledb reserves every raw name of the rowset before the handler renames any
        // column, so `COL_2`, renamed onto the `col2` that the second column already holds, is
        // the one moved to `col2_1`.
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          { outKeyTransformCase: 'camelCase' },
          async (kit): Promise<void> => {
            await expect(runQuery(kit, CASE_STRATEGY_SQL)).resolves.toEqual([
              { col2_1: 1, col2: 2 },
            ]);
          }
        );
        expect(collisionWarnings(logger)).toEqual([CASE_STRATEGY_COLLISION]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'rejects a call() whose OUT cursor returns two columns of one name',
      async (): Promise<void> => {
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          {
            packagesSettings: {
              packages: [FIXTURE_PACKAGE],
              procedureObjectList: {
                duplicateCursor: DUPLICATE_CURSOR_PROCEDURE,
              },
            },
          },
          async (kit): Promise<void> => {
            await expectKitCallRejected(
              kit.call(DUPLICATE_CURSOR_PROCEDURE),
              DUPLICATE_NAME_COLLISION
            );
          }
        );
        expect(collisionWarnings(logger)).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );
  }
);
