import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';
import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';

import {
  createPostgresIntegrationSettings,
  createPostgresReplicationIntegrationSettings,
} from './database-integration.helpers.js';
import {
  createQueryBuilderIntegrationDataSource,
  IntegrationAuditLogEntity,
  IntegrationMessageAuditEntity,
  IntegrationOrderEntity,
  queryBuilderTables,
} from './query-builder-integration.fixtures.js';

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

function createPostgresQueryBuilderDataSource(
  integrationSettings: PostgresIntegrationSettings
): DataSource {
  return createQueryBuilderIntegrationDataSource({
    type: 'postgres',
    driver: pg,
    host: integrationSettings.config.master.host,
    port: integrationSettings.config.master.port,
    database: integrationSettings.config.master.database,
    username: integrationSettings.config.master.username,
    password: integrationSettings.config.master.password,
    poolSize: 2,
    parseInt8: false,
  });
}

async function dropPostgresQueryBuilderFixture(
  dataSource: DataSource
): Promise<void> {
  await dataSource.query(`DROP TABLE IF EXISTS ${queryBuilderTables.auditLog}`);
  await dataSource.query(`DROP TABLE IF EXISTS ${queryBuilderTables.audit}`);
  await dataSource.query(`DROP TABLE IF EXISTS ${queryBuilderTables.order}`);
  await dataSource.query(`DROP TABLE IF EXISTS ${queryBuilderTables.message}`);
}

async function createPostgresQueryBuilderFixture(
  dataSource: DataSource
): Promise<void> {
  await dropPostgresQueryBuilderFixture(dataSource);

  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.message} (
      UUID4 varchar(36) PRIMARY KEY,
      IS_DELETED integer NOT NULL,
      BODY varchar(100) NOT NULL
    )
  `);
  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.order} (
      TENANT_ID varchar(20) NOT NULL,
      ORDER_NO integer NOT NULL,
      ORDER_STATUS varchar(20) NOT NULL,
      MESSAGE_UUID varchar(36) NOT NULL,
      CREATED_AT timestamp NOT NULL,
      PRIMARY KEY (TENANT_ID, ORDER_NO)
    )
  `);
  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.audit} (
      ID integer PRIMARY KEY,
      MESSAGE_UUID varchar(36) NOT NULL,
      CREATED_AT timestamp NOT NULL
    )
  `);
  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.auditLog} (
      ID integer PRIMARY KEY,
      STATUS varchar(20) NOT NULL,
      DELETED_AT timestamp NULL,
      UPDATED_AT timestamp NOT NULL,
      ROW_VERSION integer NOT NULL
    )
  `);

  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.message} (UUID4, IS_DELETED, BODY) VALUES
      ('m-1', 0, 'first message'),
      ('m-2', 0, 'second message'),
      ('m-3', 1, 'deleted message')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.order}
      (TENANT_ID, ORDER_NO, ORDER_STATUS, MESSAGE_UUID, CREATED_AT)
    VALUES
      ('acme', 101, 'open', 'm-1', TIMESTAMP '2026-01-01 10:00:00'),
      ('acme', 102, 'open', 'm-1', TIMESTAMP '2026-01-02 10:00:00'),
      ('acme', 103, 'open', 'm-2', TIMESTAMP '2026-01-03 10:00:00'),
      ('acme', 104, 'closed', 'm-3', TIMESTAMP '2026-01-04 10:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.audit} (ID, MESSAGE_UUID, CREATED_AT) VALUES
      (1, 'm-1', TIMESTAMP '2026-01-01 12:00:00'),
      (2, 'm-1', TIMESTAMP '2026-01-02 12:00:00'),
      (3, 'm-2', TIMESTAMP '2026-01-03 12:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.auditLog}
      (ID, STATUS, DELETED_AT, UPDATED_AT, ROW_VERSION)
    VALUES
      (1, 'ready', NULL, TIMESTAMP '2026-01-01 00:00:00', 1),
      (2, 'ready', NULL, TIMESTAMP '2026-01-01 00:00:00', 1),
      (3, 'stale', NULL, TIMESTAMP '2026-01-01 00:00:00', 1)
  `);
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

  it('executes complex QueryBuilder selects and counts against real tables', async (): Promise<void> => {
    const dataSource = createPostgresQueryBuilderDataSource(settings!);

    try {
      await dataSource.initialize();
      await createPostgresQueryBuilderFixture(dataSource);

      const queryBuilder = dataSource
        .createQueryBuilder(IntegrationOrderEntity, 'ord')
        .select('ord.TENANT_ID', 'tenant_id')
        .addSelect('ord.ORDER_NO', 'order_no')
        .addSelect('message.UUID4', 'message_uuid')
        .addSelect('"last_audit"."last_seen_at"', 'last_seen_at')
        .addSelect((subQuery) => {
          return subQuery
            .select('COUNT(audit.ID)')
            .from(IntegrationMessageAuditEntity, 'audit')
            .where('audit.MESSAGE_UUID = message.UUID4');
        }, 'audit_count')
        .innerJoin('ord.message', 'message')
        .leftJoin(
          (subQuery) => {
            return subQuery
              .select('audit.MESSAGE_UUID', 'message_uuid')
              .addSelect('MAX(audit.CREATED_AT)', 'last_seen_at')
              .from(IntegrationMessageAuditEntity, 'audit')
              .groupBy('audit.MESSAGE_UUID');
          },
          'last_audit',
          '"last_audit"."message_uuid" = message.UUID4'
        )
        .where('ord.ORDER_STATUS = :status', { status: 'open' })
        .andWhere('message.IS_DELETED = :isDeleted', { isDeleted: 0 })
        .groupBy('ord.TENANT_ID')
        .addGroupBy('ord.ORDER_NO')
        .addGroupBy('ord.CREATED_AT')
        .addGroupBy('message.UUID4')
        .addGroupBy('"last_audit"."last_seen_at"')
        .having('COUNT(message.UUID4) > :minRows', { minRows: 0 })
        .orderBy('ord.CREATED_AT', 'DESC');

      const rows = await queryBuilder.getRawMany<{
        tenant_id: string;
        order_no: number;
        message_uuid: string;
        last_seen_at: Date;
        audit_count: string;
      }>();
      const count = await queryBuilder.getCount();

      expect(
        rows.map((row) => ({
          tenantId: row.tenant_id,
          orderNo: Number(row.order_no),
          messageUuid: row.message_uuid,
          auditCount: Number(row.audit_count),
        }))
      ).toEqual([
        { tenantId: 'acme', orderNo: 103, messageUuid: 'm-2', auditCount: 1 },
        { tenantId: 'acme', orderNo: 102, messageUuid: 'm-1', auditCount: 2 },
        { tenantId: 'acme', orderNo: 101, messageUuid: 'm-1', auditCount: 2 },
      ]);
      expect(rows.every((row) => row.last_seen_at instanceof Date)).toBe(true);
      expect(count).toBe(3);
    } finally {
      if (dataSource.isInitialized) {
        await dropPostgresQueryBuilderFixture(dataSource);
        await dataSource.destroy();
      }
    }
  });

  it('executes QueryBuilder DML against real tables', async (): Promise<void> => {
    const dataSource = createPostgresQueryBuilderDataSource(settings!);

    try {
      await dataSource.initialize();
      await createPostgresQueryBuilderFixture(dataSource);

      await dataSource
        .createQueryBuilder()
        .update(IntegrationAuditLogEntity)
        .set({ status: 'processed' })
        .where('ID = :id', { id: 1 })
        .execute();
      await dataSource
        .createQueryBuilder()
        .softDelete()
        .from(IntegrationAuditLogEntity)
        .where('ID = :id', { id: 2 })
        .execute();
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(IntegrationAuditLogEntity)
        .where('ID = :id', { id: 3 })
        .execute();

      const rows = await dataSource.query<
        Array<{
          id: number;
          status: string;
          deleted_at: Date | null;
          row_version: number;
        }>
      >(`
        SELECT
          ID AS "id",
          STATUS AS "status",
          DELETED_AT AS "deleted_at",
          ROW_VERSION AS "row_version"
        FROM ${queryBuilderTables.auditLog}
        ORDER BY ID
      `);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: 1,
        status: 'processed',
        deleted_at: null,
        row_version: 2,
      });
      expect(rows[1]).toMatchObject({
        id: 2,
        status: 'ready',
        row_version: 2,
      });
      expect(rows[1]?.deleted_at).toBeInstanceOf(Date);
    } finally {
      if (dataSource.isInitialized) {
        await dropPostgresQueryBuilderFixture(dataSource);
        await dataSource.destroy();
      }
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
