import oracledb from 'oracledb';
import { describe, expect, it } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';
import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';

import { createOracleIntegrationSettings } from './database-integration.helpers.js';
import {
  createQueryBuilderIntegrationDataSource,
  IntegrationAuditLogEntity,
  IntegrationMessageAuditEntity,
  IntegrationOrderEntity,
  queryBuilderTables,
} from './query-builder-integration.fixtures.js';

const settings = createOracleIntegrationSettings();
const procedurePackage = 'tpk_it_pkg' as const;

type OracleIntegrationSettings = NonNullable<
  ReturnType<typeof createOracleIntegrationSettings>
>;

async function withOracleConnection<T>(
  integrationSettings: OracleIntegrationSettings,
  callback: (connection: oracledb.Connection) => Promise<T>
): Promise<T> {
  const connection = await oracledb.getConnection({
    user: integrationSettings.config.master.username,
    password: integrationSettings.config.master.password,
    connectString: `${integrationSettings.config.master.host}:${integrationSettings.config.master.port}/${integrationSettings.config.master.database}`,
  });

  try {
    return await callback(connection);
  } finally {
    await connection.close();
  }
}

async function dropOracleProcedureFixture(
  integrationSettings: OracleIntegrationSettings
): Promise<void> {
  await withOracleConnection(integrationSettings, async (connection) => {
    await connection.execute(`
      BEGIN
        EXECUTE IMMEDIATE 'DROP PACKAGE ${procedurePackage.toUpperCase()}';
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLCODE != -4043 THEN
            RAISE;
          END IF;
      END;
    `);
  });
}

async function createOracleProcedureFixture(
  integrationSettings: OracleIntegrationSettings
): Promise<void> {
  await dropOracleProcedureFixture(integrationSettings);
  await withOracleConnection(integrationSettings, async (connection) => {
    await connection.execute(`
      CREATE OR REPLACE PACKAGE ${procedurePackage.toUpperCase()} AS
        PROCEDURE ECHO_VALUES(
          P_VALUE IN NUMBER,
          P_LABEL IN VARCHAR2,
          OUT_CURSOR OUT SYS_REFCURSOR
        );
      END ${procedurePackage.toUpperCase()};
    `);
    await connection.execute(`
      CREATE OR REPLACE PACKAGE BODY ${procedurePackage.toUpperCase()} AS
        PROCEDURE ECHO_VALUES(
          P_VALUE IN NUMBER,
          P_LABEL IN VARCHAR2,
          OUT_CURSOR OUT SYS_REFCURSOR
        ) AS
        BEGIN
          OPEN OUT_CURSOR FOR
            SELECT P_VALUE + 1 AS result, P_LABEL AS label FROM dual;
        END ECHO_VALUES;
      END ${procedurePackage.toUpperCase()};
    `);
  });
}

function createOracleQueryBuilderDataSource(
  integrationSettings: OracleIntegrationSettings
): DataSource {
  return createQueryBuilderIntegrationDataSource({
    type: 'oracle',
    host: integrationSettings.config.master.host,
    port: integrationSettings.config.master.port,
    username: integrationSettings.config.master.username,
    password: integrationSettings.config.master.password,
    database: integrationSettings.config.master.database,
    serviceName: integrationSettings.config.master.database,
    poolSize: 2,
  });
}

async function dropOracleTableIfExists(
  dataSource: DataSource,
  tableName: string
): Promise<void> {
  await dataSource.query(`
    BEGIN
      EXECUTE IMMEDIATE 'DROP TABLE ${tableName} PURGE';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -942 THEN
          RAISE;
        END IF;
    END;
  `);
}

async function dropOracleQueryBuilderFixture(
  dataSource: DataSource
): Promise<void> {
  await dropOracleTableIfExists(dataSource, queryBuilderTables.auditLog);
  await dropOracleTableIfExists(dataSource, queryBuilderTables.audit);
  await dropOracleTableIfExists(dataSource, queryBuilderTables.order);
  await dropOracleTableIfExists(dataSource, queryBuilderTables.message);
}

async function createOracleQueryBuilderFixture(
  dataSource: DataSource
): Promise<void> {
  await dropOracleQueryBuilderFixture(dataSource);

  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.message} (
      UUID4 varchar2(36) PRIMARY KEY,
      IS_DELETED number(1) NOT NULL,
      BODY varchar2(100) NOT NULL
    )
  `);
  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.order} (
      TENANT_ID varchar2(20) NOT NULL,
      ORDER_NO number(10) NOT NULL,
      ORDER_STATUS varchar2(20) NOT NULL,
      MESSAGE_UUID varchar2(36) NOT NULL,
      CREATED_AT timestamp NOT NULL,
      PRIMARY KEY (TENANT_ID, ORDER_NO)
    )
  `);
  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.audit} (
      ID number(10) PRIMARY KEY,
      MESSAGE_UUID varchar2(36) NOT NULL,
      CREATED_AT timestamp NOT NULL
    )
  `);
  await dataSource.query(`
    CREATE TABLE ${queryBuilderTables.auditLog} (
      ID number(10) PRIMARY KEY,
      STATUS varchar2(20) NOT NULL,
      DELETED_AT timestamp NULL,
      UPDATED_AT timestamp NOT NULL,
      ROW_VERSION number(10) NOT NULL
    )
  `);

  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.message} (UUID4, IS_DELETED, BODY)
    VALUES ('m-1', 0, 'first message')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.message} (UUID4, IS_DELETED, BODY)
    VALUES ('m-2', 0, 'second message')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.message} (UUID4, IS_DELETED, BODY)
    VALUES ('m-3', 1, 'deleted message')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.order}
      (TENANT_ID, ORDER_NO, ORDER_STATUS, MESSAGE_UUID, CREATED_AT)
    VALUES
      ('acme', 101, 'open', 'm-1', TIMESTAMP '2026-01-01 10:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.order}
      (TENANT_ID, ORDER_NO, ORDER_STATUS, MESSAGE_UUID, CREATED_AT)
    VALUES
      ('acme', 102, 'open', 'm-1', TIMESTAMP '2026-01-02 10:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.order}
      (TENANT_ID, ORDER_NO, ORDER_STATUS, MESSAGE_UUID, CREATED_AT)
    VALUES
      ('acme', 103, 'open', 'm-2', TIMESTAMP '2026-01-03 10:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.order}
      (TENANT_ID, ORDER_NO, ORDER_STATUS, MESSAGE_UUID, CREATED_AT)
    VALUES
      ('acme', 104, 'closed', 'm-3', TIMESTAMP '2026-01-04 10:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.audit} (ID, MESSAGE_UUID, CREATED_AT)
    VALUES (1, 'm-1', TIMESTAMP '2026-01-01 12:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.audit} (ID, MESSAGE_UUID, CREATED_AT)
    VALUES (2, 'm-1', TIMESTAMP '2026-01-02 12:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.audit} (ID, MESSAGE_UUID, CREATED_AT)
    VALUES (3, 'm-2', TIMESTAMP '2026-01-03 12:00:00')
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.auditLog}
      (ID, STATUS, DELETED_AT, UPDATED_AT, ROW_VERSION)
    VALUES
      (1, 'ready', NULL, TIMESTAMP '2026-01-01 00:00:00', 1)
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.auditLog}
      (ID, STATUS, DELETED_AT, UPDATED_AT, ROW_VERSION)
    VALUES
      (2, 'ready', NULL, TIMESTAMP '2026-01-01 00:00:00', 1)
  `);
  await dataSource.query(`
    INSERT INTO ${queryBuilderTables.auditLog}
      (ID, STATUS, DELETED_AT, UPDATED_AT, ROW_VERSION)
    VALUES
      (3, 'stale', NULL, TIMESTAMP '2026-01-01 00:00:00', 1)
  `);
}

describe.skipIf(!settings)('Oracle integration', (): void => {
  it('initializes the library and executes real SQL through public methods', async (): Promise<void> => {
    const kit = new TypeOrmProcedureKit(settings!);

    try {
      await kit.initDatabase();

      const transactionRows = await kit.callSqlTransaction<{
        result: number;
        label: string;
      }>('SELECT :VALUE + 1 AS result, :LABEL AS label FROM dual', {
        value: 41,
        label: 'oracle',
      });

      expect(transactionRows).toEqual([{ result: 42, label: 'oracle' }]);

      const manager = await kit.getEntityManager();
      try {
        const managerRows = await manager.query<Array<{ result: number }>>(
          'SELECT 7 AS result FROM dual'
        );
        expect(managerRows).toEqual([{ result: 7 }]);
      } finally {
        await kit.releaseEntityManager(manager);
      }
    } finally {
      await kit.destroy();
    }
  });

  it('loads package metadata and calls a real stored procedure', async (): Promise<void> => {
    await createOracleProcedureFixture(settings!);

    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        packagesSettings: {
          packages: [procedurePackage],
          procedureObjectList: {
            echoValues: `${procedurePackage}.echo_values`,
          },
        },
      },
    });

    try {
      await kit.initDatabase();

      const rows = await kit.call<{ result: number; label: string }>(
        `${procedurePackage}.echo_values`,
        {
          value: 41,
          label: 'procedure',
        }
      );

      expect(rows).toEqual([{ result: 42, label: 'procedure' }]);
    } finally {
      await kit.destroy();
      await dropOracleProcedureFixture(settings!);
    }
  });

  it('executes complex QueryBuilder selects and counts against real tables', async (): Promise<void> => {
    const dataSource = createOracleQueryBuilderDataSource(settings!);

    try {
      await dataSource.initialize();
      await createOracleQueryBuilderFixture(dataSource);

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
        audit_count: number;
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
        await dropOracleQueryBuilderFixture(dataSource);
        await dataSource.destroy();
      }
    }
  });

  it('executes QueryBuilder DML against real tables', async (): Promise<void> => {
    const dataSource = createOracleQueryBuilderDataSource(settings!);

    try {
      await dataSource.initialize();
      await createOracleQueryBuilderFixture(dataSource);

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
        await dropOracleQueryBuilderFixture(dataSource);
        await dataSource.destroy();
      }
    }
  });
});
