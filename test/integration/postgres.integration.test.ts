import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';

import {
  createPostgresIntegrationSettings,
  createPostgresReplicationIntegrationSettings,
} from './database-integration.helpers.js';

const settings = createPostgresIntegrationSettings();
const replicationSettings = createPostgresReplicationIntegrationSettings();
const procedureSchema = 'tpk_it_proc' as const;

type PostgresIntegrationSettings = NonNullable<
  ReturnType<typeof createPostgresIntegrationSettings>
>;

interface PostgresDriverWithReplicationMethods {
  obtainMasterConnection: () => Promise<unknown>;
  obtainSlaveConnection: () => Promise<unknown>;
}

async function withPostgresClient<T>(
  integrationSettings: PostgresIntegrationSettings,
  callback: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = new pg.Client({
    host: integrationSettings.config.master.host,
    port: integrationSettings.config.master.port,
    database: integrationSettings.config.master.database,
    user: integrationSettings.config.master.username,
    password: integrationSettings.config.master.password,
  });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function createPostgresProcedureFixture(
  integrationSettings: PostgresIntegrationSettings
): Promise<void> {
  await withPostgresClient(integrationSettings, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${procedureSchema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${procedureSchema}"`);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".echo_values(
        IN p_value integer,
        IN p_label text,
        INOUT out_cursor refcursor
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        OPEN out_cursor FOR
          SELECT (p_value + 1)::integer AS result, p_label AS label;
      END;
      $$;
    `);
  });
}

async function dropPostgresProcedureFixture(
  integrationSettings: PostgresIntegrationSettings
): Promise<void> {
  await withPostgresClient(integrationSettings, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${procedureSchema}" CASCADE`);
  });
}

describe.skipIf(!settings)('PostgreSQL integration', (): void => {
  it('initializes the library and executes real SQL through public methods', async (): Promise<void> => {
    const kit = new TypeOrmProcedureKit(settings!);

    try {
      await kit.initDatabase();

      const transactionRows = await kit.callSqlTransaction<{
        result: number;
        label: string;
      }>('SELECT (:VALUE::int + 1) AS result, :LABEL::text AS label', {
        value: 41,
        label: 'postgres',
      });

      expect(transactionRows).toEqual([{ result: 42, label: 'postgres' }]);

      const manager = await kit.getEntityManager();
      try {
        const managerRows = await manager.query<Array<{ result: number }>>(
          'SELECT 7::int AS result'
        );
        expect(managerRows).toEqual([{ result: 7 }]);
      } finally {
        await kit.releaseEntityManager(manager);
      }
    } finally {
      await kit.destroy();
    }
  });

  it('loads procedure metadata and calls a real stored procedure', async (): Promise<void> => {
    await createPostgresProcedureFixture(settings!);

    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        packagesSettings: {
          packages: [procedureSchema],
          procedureObjectList: {
            echoValues: `${procedureSchema}.echo_values`,
          },
        },
      },
    });

    try {
      await kit.initDatabase();

      const rows = await kit.call<{ result: number; label: string }>(
        `${procedureSchema}.echo_values`,
        {
          value: 41,
          label: 'procedure',
        }
      );

      expect(rows).toEqual([{ result: 42, label: 'procedure' }]);
    } finally {
      await kit.destroy();
      await dropPostgresProcedureFixture(settings!);
    }
  });
});

describe.skipIf(!replicationSettings)(
  'PostgreSQL replication integration',
  (): void => {
    it('routes public execution modes and SelectQueryBuilder reads through slave connections', async (): Promise<void> => {
      const kit = new TypeOrmProcedureKit(replicationSettings!);

      try {
        await kit.initDatabase();

        const driver = kit.dataSource
          .driver as unknown as PostgresDriverWithReplicationMethods;
        const masterSpy = vi.spyOn(driver, 'obtainMasterConnection');
        const slaveSpy = vi.spyOn(driver, 'obtainSlaveConnection');

        const masterRows = await kit.callSqlTransaction<{ value: number }>(
          'SELECT :VALUE::int AS value',
          { VALUE: 1 },
          { mode: 'master' }
        );

        expect(masterRows).toEqual([{ value: 1 }]);
        expect(masterSpy).toHaveBeenCalledTimes(1);
        expect(slaveSpy).not.toHaveBeenCalled();

        masterSpy.mockClear();
        slaveSpy.mockClear();

        const slaveRows = await kit.callSqlTransaction<{ value: number }>(
          'SELECT :VALUE::int AS value',
          { VALUE: 2 },
          { mode: 'slave' }
        );

        expect(slaveRows).toEqual([{ value: 2 }]);
        expect(slaveSpy).toHaveBeenCalledTimes(1);
        expect(masterSpy).not.toHaveBeenCalled();

        masterSpy.mockClear();
        slaveSpy.mockClear();

        const queryBuilderRows = await kit.dataSource
          .createQueryBuilder()
          .select('3::int', 'value')
          .fromDummy()
          .getRawMany<{ value: number }>();

        expect(queryBuilderRows).toEqual([{ value: 3 }]);
        expect(slaveSpy).toHaveBeenCalledTimes(1);
        expect(masterSpy).not.toHaveBeenCalled();
      } finally {
        await kit.destroy();
      }
    });
  }
);
