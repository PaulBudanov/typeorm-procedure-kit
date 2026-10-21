import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ServerError } from '../../src/index.js';
import { createLogger } from '../support/helpers.js';

import {
  createPostgresIntegrationSettings,
  withKit,
  withPostgresClient,
} from './database-integration.helpers.js';

import type { TypeOrmProcedureKit } from '../../src/index.js';
import type { ITestLogger } from '../support/helpers.js';

/** Generous per-case budget: every case opens its own kit and pool on a shared CI database. */
const TEST_TIMEOUT_MS = 60_000;
const settings = createPostgresIntegrationSettings();
const FIXTURE_SCHEMA = 'tpk_it_scope' as const;
const DUPLICATE_CURSOR_PROCEDURE = `${FIXTURE_SCHEMA}.duplicate_cursor`;

/** Two columns under one raw name: node-postgres keeps one key, holding the second value. */
const DUPLICATE_NAME_SQL = 'SELECT 1 AS id, 2 AS id';
const DUPLICATE_NAME_COLLISION =
  'PostgreSQL result columns "id" and "id" have conflicting transformed name "id"';
/** Two distinct raw names that only meet after the `lowerCase` key strategy of the settings. */
const CASE_STRATEGY_SQL = 'SELECT 1 AS "FOO", 2 AS foo';
const CASE_STRATEGY_COLLISION =
  'PostgreSQL result columns "FOO" and "foo" have conflicting transformed name "foo"';
/** `RETURNING *` of an `UPDATE ... FROM` returns the `id` of both tables. */
const UPDATE_RETURNING_ALL_SQL = `
  UPDATE ${FIXTURE_SCHEMA}.item AS item
     SET label = src.new_label
    FROM ${FIXTURE_SCHEMA}.label_source AS src
   WHERE src.id = item.id
  RETURNING *
`;

type TRawQueryRunner = (
  kit: TypeOrmProcedureKit,
  sql: string
) => Promise<unknown>;

/**
 * The two ways a consumer runs raw SQL on the kit's pool outside a kit call. Neither goes through
 * `ExecuteBase`, so neither carries the kit-call mark.
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
 * Drops the fixture schema with everything in it; a missing schema is not an error.
 * @param integrationSettings - PostgreSQL integration settings.
 */
async function dropFixture(
  integrationSettings: NonNullable<typeof settings>
): Promise<void> {
  await withPostgresClient(
    integrationSettings,
    async (client): Promise<void> => {
      await client.query(`DROP SCHEMA IF EXISTS ${FIXTURE_SCHEMA} CASCADE`);
    }
  );
}

/**
 * Creates the fixture schema: two tables that share the column `id`, one row in each, and a
 * procedure whose named OUT cursor returns two columns called `id`.
 * @param integrationSettings - PostgreSQL integration settings.
 */
async function createFixture(
  integrationSettings: NonNullable<typeof settings>
): Promise<void> {
  await dropFixture(integrationSettings);
  await withPostgresClient(
    integrationSettings,
    async (client): Promise<void> => {
      await client.query(`CREATE SCHEMA ${FIXTURE_SCHEMA}`);
      await client.query(`
        CREATE TABLE ${FIXTURE_SCHEMA}.item (
          id integer PRIMARY KEY,
          label text NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE ${FIXTURE_SCHEMA}.label_source (
          id integer PRIMARY KEY,
          new_label text NOT NULL
        )
      `);
      await client.query(
        `INSERT INTO ${FIXTURE_SCHEMA}.item (id, label) VALUES (1, 'pending')`
      );
      await client.query(
        `INSERT INTO ${FIXTURE_SCHEMA}.label_source (id, new_label) VALUES (1, 'applied')`
      );
      await client.query(`
        CREATE PROCEDURE ${DUPLICATE_CURSOR_PROCEDURE}(
          OUT out_cursor refcursor
        )
        LANGUAGE plpgsql
        AS $$
        BEGIN
          out_cursor := 'tpk_it_scope_duplicate_cursor';
          OPEN out_cursor FOR EXECUTE 'SELECT 1 AS id, 2 AS id';
        END;
        $$;
      `);
    }
  );
}

/**
 * Asserts that a kit call failed on the column collision itself. The serializer raises the
 * collision inside the query runner, which wraps it in a `QueryFailedError`; the kit then turns
 * that into a `ServerError` carrying the wrapper's message, hence the `ServerError: ` prefix.
 * @param pending - the kit call.
 * @param collision - the collision text the serializer raised.
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
        message.startsWith('PostgreSQL result columns ') &&
        message.includes(' have conflicting transformed name ')
    );
}

describe.skipIf(!settings)(
  'PostgreSQL duplicate result columns by call site',
  (): void => {
    beforeAll(async (): Promise<void> => {
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
      'returns the rows of that SQL through %s and warns once',
      async (_label, runQuery): Promise<void> => {
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          {},
          async (kit): Promise<void> => {
            await expect(runQuery(kit, DUPLICATE_NAME_SQL)).resolves.toEqual([
              { id: 2 },
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
          {},
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
      'returns the rows of the case-strategy collision through %s, the later column winning, and warns once',
      async (_label, runQuery): Promise<void> => {
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          {},
          async (kit): Promise<void> => {
            await expect(runQuery(kit, CASE_STRATEGY_SQL)).resolves.toEqual([
              { foo: 2 },
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
              packages: [FIXTURE_SCHEMA],
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

    it(
      'streams rows outside a kit call on the one pooled connection a kit call has just used, and warns once',
      async (): Promise<void> => {
        // With a single pooled connection the stream runs on the very socket the kit call used.
        // Streamed rows are renamed in the async context of that socket, so the socket must not
        // carry the kit-call mark after the kit call has finished.
        // The socket predates the kit call; acquiring under the mark is covered by execute-base.test.ts.
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          { poolSize: 1 },
          async (kit): Promise<void> => {
            const kitRows = await kit.callSqlTransaction<{ pid: number }>(
              'SELECT pg_backend_pid() AS pid'
            );
            expect(kitRows).toEqual([{ pid: expect.any(Number) }]);
            const kitBackendPid = kitRows[0]?.pid;

            const queryRunner = kit.dataSource.createQueryRunner();
            try {
              const stream = await queryRunner.stream(
                'SELECT pg_backend_pid() AS pid, step AS id, step * 10 AS id FROM generate_series(1, 3) AS step'
              );
              await expect(stream.toArray()).resolves.toEqual([
                { pid: kitBackendPid, id: 10 },
                { pid: kitBackendPid, id: 20 },
                { pid: kitBackendPid, id: 30 },
              ]);
            } finally {
              await queryRunner.release();
            }
          }
        );
        expect(collisionWarnings(logger)).toEqual([DUPLICATE_NAME_COLLISION]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'applies an UPDATE whose RETURNING * repeats a column outside a transaction, returns its rows and warns once',
      async (): Promise<void> => {
        const logger = createLogger();

        await withKit(
          withCaseLogger(logger),
          {},
          async (kit): Promise<void> => {
            // The runner returns `[rows, rowCount]` for UPDATE.
            await expect(
              kit.dataSource.query(UPDATE_RETURNING_ALL_SQL)
            ).resolves.toEqual([
              [{ id: 1, label: 'applied', new_label: 'applied' }],
              1,
            ]);
          }
        );
        expect(collisionWarnings(logger)).toEqual([DUPLICATE_NAME_COLLISION]);

        const storedRows = await withPostgresClient(
          settings!,
          async (client): Promise<Array<{ id: number; label: string }>> => {
            const result = await client.query<{ id: number; label: string }>(
              `SELECT id, label FROM ${FIXTURE_SCHEMA}.item ORDER BY id`
            );
            return result.rows;
          }
        );
        expect(storedRows).toEqual([{ id: 1, label: 'applied' }]);
      },
      TEST_TIMEOUT_MS
    );
  }
);
