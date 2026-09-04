import oracledb from 'oracledb';
import { beforeAll, describe, expect, it } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';

import { createOracleIntegrationSettings } from './database-integration.helpers.js';
import {
  createQueryBuilderIntegrationDataSource,
  IntegrationAuditLogEntity,
  IntegrationMessageAuditEntity,
  IntegrationOrderEntity,
  queryBuilderTables,
} from './query-builder-integration.fixtures.js';

import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';

const settings = createOracleIntegrationSettings();
const procedurePackage = 'tpk_it_pkg' as const;

type TOracleIntegrationSettings = NonNullable<
  ReturnType<typeof createOracleIntegrationSettings>
>;

async function withOracleConnection<T>(
  integrationSettings: TOracleIntegrationSettings,
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
  integrationSettings: TOracleIntegrationSettings
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
  integrationSettings: TOracleIntegrationSettings
): Promise<void> {
  await dropOracleProcedureFixture(integrationSettings);
  await withOracleConnection(integrationSettings, async (connection) => {
    await connection.execute(`
      CREATE OR REPLACE PACKAGE ${procedurePackage.toUpperCase()} AS
        TYPE SHIP_RECORD IS RECORD (
          SHIP_NAME VARCHAR2(40),
          WEIGHT NUMBER,
          SAILED_AT TIMESTAMP WITH TIME ZONE,
          TOKEN RAW(4)
        );
        PROCEDURE ECHO_VALUES(
          P_VALUE IN NUMBER,
          P_LABEL IN VARCHAR2,
          P_COUNT IN OUT NUMBER,
          OUT_DATE OUT DATE,
          OUT_TIMESTAMP OUT TIMESTAMP,
          OUT_TSTZ OUT TIMESTAMP WITH TIME ZONE,
          OUT_TSLTZ OUT TIMESTAMP WITH LOCAL TIME ZONE,
          OUT_CURSOR OUT SYS_REFCURSOR,
          OUT_SECOND_CURSOR OUT SYS_REFCURSOR
        );
        PROCEDURE ECHO_TEMPORALS(
          P_DATE_IN IN DATE,
          P_TIMESTAMP_IN IN TIMESTAMP,
          P_TSTZ_IN IN TIMESTAMP WITH TIME ZONE,
          P_TSLTZ_IN IN TIMESTAMP WITH LOCAL TIME ZONE,
          OUT_DATE OUT DATE,
          OUT_TIMESTAMP OUT TIMESTAMP,
          OUT_TSTZ OUT TIMESTAMP WITH TIME ZONE,
          OUT_TSLTZ OUT TIMESTAMP WITH LOCAL TIME ZONE,
          P_DATE_IN_OUT IN OUT DATE,
          P_TIMESTAMP_IN_OUT IN OUT TIMESTAMP,
          P_TSTZ_IN_OUT IN OUT TIMESTAMP WITH TIME ZONE,
          P_TSLTZ_IN_OUT IN OUT TIMESTAMP WITH LOCAL TIME ZONE
        );
        PROCEDURE TRANSFORM_RECORD(
          P_INPUT IN SHIP_RECORD,
          P_IN_OUT IN OUT SHIP_RECORD,
          P_OUTPUT OUT SHIP_RECORD
        );
      END ${procedurePackage.toUpperCase()};
    `);
    await connection.execute(`
      CREATE OR REPLACE PACKAGE BODY ${procedurePackage.toUpperCase()} AS
        PROCEDURE ECHO_VALUES(
          P_VALUE IN NUMBER,
          P_LABEL IN VARCHAR2,
          P_COUNT IN OUT NUMBER,
          OUT_DATE OUT DATE,
          OUT_TIMESTAMP OUT TIMESTAMP,
          OUT_TSTZ OUT TIMESTAMP WITH TIME ZONE,
          OUT_TSLTZ OUT TIMESTAMP WITH LOCAL TIME ZONE,
          OUT_CURSOR OUT SYS_REFCURSOR,
          OUT_SECOND_CURSOR OUT SYS_REFCURSOR
        ) AS
        BEGIN
          P_COUNT := P_COUNT + 1;
          OUT_DATE := TO_DATE(
            '2026-07-16 12:30:45',
            'YYYY-MM-DD HH24:MI:SS'
          );
          OUT_TIMESTAMP := TIMESTAMP '2026-07-16 12:30:45.123456';
          OUT_TSTZ := TO_TIMESTAMP_TZ(
            '2026-07-16 12:30:45.123456 +03:00',
            'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'
          );
          OUT_TSLTZ := CAST(
            TO_TIMESTAMP_TZ(
              '2026-07-16 12:30:45.123456 +03:00',
              'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'
            ) AS TIMESTAMP WITH LOCAL TIME ZONE
          );
          OPEN OUT_CURSOR FOR
            SELECT
              P_VALUE + 1 AS result,
              P_LABEL AS label,
              'first' AS source,
              TO_DATE(
                '2026-07-16 12:30:45',
                'YYYY-MM-DD HH24:MI:SS'
              ) AS cursor_date,
              TIMESTAMP '2026-07-16 12:30:45.123456' AS cursor_timestamp,
              TO_TIMESTAMP_TZ(
                '2026-07-16 12:30:45.123456 +03:00',
                'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'
              ) AS cursor_tstz,
              CAST(
                TO_TIMESTAMP_TZ(
                  '2026-07-16 12:30:45.123456 +03:00',
                  'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'
                ) AS TIMESTAMP WITH LOCAL TIME ZONE
              ) AS cursor_tsltz
            FROM dual;
          OPEN OUT_SECOND_CURSOR FOR
            SELECT
              P_VALUE + 2 AS result,
              P_LABEL AS label,
              'second' AS source
            FROM dual;
        END ECHO_VALUES;
        PROCEDURE ECHO_TEMPORALS(
          P_DATE_IN IN DATE,
          P_TIMESTAMP_IN IN TIMESTAMP,
          P_TSTZ_IN IN TIMESTAMP WITH TIME ZONE,
          P_TSLTZ_IN IN TIMESTAMP WITH LOCAL TIME ZONE,
          OUT_DATE OUT DATE,
          OUT_TIMESTAMP OUT TIMESTAMP,
          OUT_TSTZ OUT TIMESTAMP WITH TIME ZONE,
          OUT_TSLTZ OUT TIMESTAMP WITH LOCAL TIME ZONE,
          P_DATE_IN_OUT IN OUT DATE,
          P_TIMESTAMP_IN_OUT IN OUT TIMESTAMP,
          P_TSTZ_IN_OUT IN OUT TIMESTAMP WITH TIME ZONE,
          P_TSLTZ_IN_OUT IN OUT TIMESTAMP WITH LOCAL TIME ZONE
        ) AS
        BEGIN
          OUT_DATE := P_DATE_IN;
          OUT_TIMESTAMP := P_TIMESTAMP_IN;
          OUT_TSTZ := P_TSTZ_IN;
          OUT_TSLTZ := P_TSLTZ_IN;
          P_DATE_IN_OUT := P_DATE_IN_OUT + (2 / 86400);
          P_TIMESTAMP_IN_OUT :=
            P_TIMESTAMP_IN_OUT + NUMTODSINTERVAL(2, 'SECOND');
          P_TSTZ_IN_OUT := P_TSTZ_IN_OUT + NUMTODSINTERVAL(2, 'SECOND');
          P_TSLTZ_IN_OUT := P_TSLTZ_IN_OUT + NUMTODSINTERVAL(2, 'SECOND');
        END ECHO_TEMPORALS;
        PROCEDURE TRANSFORM_RECORD(
          P_INPUT IN SHIP_RECORD,
          P_IN_OUT IN OUT SHIP_RECORD,
          P_OUTPUT OUT SHIP_RECORD
        ) AS
        BEGIN
          P_OUTPUT := P_INPUT;
          P_OUTPUT.SHIP_NAME := P_INPUT.SHIP_NAME || '-out';
          P_OUTPUT.WEIGHT := NVL(P_INPUT.WEIGHT, 0) + 10;
          P_IN_OUT.SHIP_NAME := P_IN_OUT.SHIP_NAME || '-inout';
          P_IN_OUT.WEIGHT := NVL(P_IN_OUT.WEIGHT, 0) + 1;
          P_IN_OUT.SAILED_AT := P_INPUT.SAILED_AT;
          P_IN_OUT.TOKEN := P_INPUT.TOKEN;
        END TRANSFORM_RECORD;
      END ${procedurePackage.toUpperCase()};
    `);
  });
}

function createOracleQueryBuilderDataSource(
  integrationSettings: TOracleIntegrationSettings
): DataSource {
  return createQueryBuilderIntegrationDataSource({
    type: 'oracle',
    driver: oracledb,
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
  beforeAll((): void => {
    const libraryPath = settings?.config.libraryPath;
    if (!libraryPath || !oracledb.thin) return;

    // Thick mode must be selected before the first standalone connection.
    oracledb.initOracleClient({ libDir: libraryPath });
  });

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
        isNeedRegisterDefaultSerializers: true,
        sessionTimeZone: 'UTC',
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

      const result = await kit.call<{
        result: number;
        label: string;
        source: string;
        cursorDate?: string;
        cursorTimestamp?: string;
        cursorTstz?: string;
        cursorTsltz?: string;
      }>(`${procedurePackage}.echo_values`, {
        value: 41,
        label: 'procedure',
        count: 5,
      });

      expect(result).toEqual({
        rows: [
          {
            result: 42,
            label: 'procedure',
            source: 'first',
            cursorDate: '2026-07-16 12:30:45',
            cursorTimestamp: '2026-07-16 12:30:45.123',
            cursorTstz: '2026-07-16T09:30:45.123Z',
            cursorTsltz: '2026-07-16T09:30:45.123Z',
          },
          { result: 43, label: 'procedure', source: 'second' },
        ],
        outBinds: {
          p_count: 6,
          out_date: '2026-07-16 12:30:45',
          out_timestamp: '2026-07-16 12:30:45.123',
          out_tstz: '2026-07-16T09:30:45.123Z',
          out_tsltz: '2026-07-16T09:30:45.123Z',
          out_cursor: [
            {
              result: 42,
              label: 'procedure',
              source: 'first',
              cursorDate: '2026-07-16 12:30:45',
              cursorTimestamp: '2026-07-16 12:30:45.123',
              cursorTstz: '2026-07-16T09:30:45.123Z',
              cursorTsltz: '2026-07-16T09:30:45.123Z',
            },
          ],
          out_second_cursor: [
            { result: 43, label: 'procedure', source: 'second' },
          ],
        },
      });
    } finally {
      await kit.destroy();
      await dropOracleProcedureFixture(settings!);
    }
  });

  it('binds Oracle temporal IN, OUT, and IN OUT procedure arguments', async (): Promise<void> => {
    await createOracleProcedureFixture(settings!);

    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        isNeedRegisterDefaultSerializers: true,
        sessionTimeZone: 'UTC',
        packagesSettings: {
          packages: [procedurePackage],
          procedureObjectList: {
            echoTemporals: `${procedurePackage}.echo_temporals`,
          },
        },
      },
    });
    const input = new Date('2026-07-16T12:30:45.678Z');

    try {
      await kit.initDatabase();

      const result = await kit.call<
        never,
        {
          date_in: Date;
          timestamp_in: Date;
          tstz_in: Date;
          tsltz_in: Date;
          date_in_out: Date;
          timestamp_in_out: Date;
          tstz_in_out: Date;
          tsltz_in_out: Date;
        },
        {
          out_date: string;
          out_timestamp: string;
          out_tstz: string;
          out_tsltz: string;
          p_date_in_out: string;
          p_timestamp_in_out: string;
          p_tstz_in_out: string;
          p_tsltz_in_out: string;
        }
      >(`${procedurePackage}.echo_temporals`, {
        date_in: input,
        timestamp_in: input,
        tstz_in: input,
        tsltz_in: input,
        date_in_out: input,
        timestamp_in_out: input,
        tstz_in_out: input,
        tsltz_in_out: input,
      });

      expect(result).toEqual({
        rows: [],
        outBinds: {
          out_date: '2026-07-16 12:30:45',
          out_timestamp: '2026-07-16 12:30:45.678',
          out_tstz: '2026-07-16T12:30:45.678Z',
          out_tsltz: '2026-07-16T12:30:45.678Z',
          p_date_in_out: '2026-07-16 12:30:47',
          p_timestamp_in_out: '2026-07-16 12:30:47.678',
          p_tstz_in_out: '2026-07-16T12:30:47.678Z',
          p_tsltz_in_out: '2026-07-16T12:30:47.678Z',
        },
      });
    } finally {
      await kit.destroy();
      await dropOracleProcedureFixture(settings!);
    }
  });

  it('binds and materializes a package-spec PL/SQL RECORD', async (): Promise<void> => {
    await createOracleProcedureFixture(settings!);

    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        isNeedRegisterDefaultSerializers: true,
        sessionTimeZone: 'UTC',
        packagesSettings: {
          packages: [procedurePackage],
          procedureObjectList: {
            transformRecord: `${procedurePackage}.transform_record`,
          },
        },
      },
    });
    const token = Buffer.from([1, 2, 3, 4]);

    try {
      await kit.initDatabase();

      const result = await kit.call<
        never,
        {
          input: {
            ship_name: string;
            weight: number;
            sailed_at: string;
            token: Buffer;
          };
          in_out: { ship_name: string };
        },
        {
          p_in_out: {
            ship_name: string;
            weight: number;
            sailed_at: string;
            token: Buffer;
          };
          p_output: {
            ship_name: string;
            weight: number;
            sailed_at: string;
            token: Buffer;
          };
        }
      >(`${procedurePackage}.transform_record`, {
        input: {
          ship_name: 'Aurora',
          weight: 1200,
          sailed_at: '2026-07-16 12:30:45.123 +03:00',
          token,
        },
        in_out: { ship_name: 'Before' },
      });

      expect(result).toEqual({
        rows: [],
        outBinds: {
          p_in_out: {
            ship_name: 'Before-inout',
            weight: 1,
            sailed_at: '2026-07-16T09:30:45.123Z',
            token,
          },
          p_output: {
            ship_name: 'Aurora-out',
            weight: 1210,
            sailed_at: '2026-07-16T09:30:45.123Z',
            token,
          },
        },
      });
    } finally {
      await kit.destroy();
      await dropOracleProcedureFixture(settings!);
    }
  });

  it('serializes all Oracle temporal fetch types in a UTC session', async (): Promise<void> => {
    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        isNeedRegisterDefaultSerializers: true,
        sessionTimeZone: 'UTC',
      },
    });

    try {
      await kit.initDatabase();

      const rows = await kit.callSqlTransaction<{
        date_value: string;
        timestamp_value: string;
        timestamp_tz_value: string;
        timestamp_ltz_value: string;
      }>(
        `
          SELECT
            TO_DATE(
              '2026-07-16 12:30:45',
              'YYYY-MM-DD HH24:MI:SS'
            ) AS date_value,
            TIMESTAMP '2026-07-16 12:30:45.123456' AS timestamp_value,
            TO_TIMESTAMP_TZ(
              '2026-07-16 12:30:45.123456 +03:00',
              'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'
            ) AS timestamp_tz_value,
            CAST(
              TO_TIMESTAMP_TZ(
                '2026-07-16 12:30:45.123456 +03:00',
                'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM'
              ) AS TIMESTAMP WITH LOCAL TIME ZONE
            ) AS timestamp_ltz_value
          FROM dual
        `,
        undefined,
        {
          optionsCommands: [
            "ALTER SESSION SET NLS_DATE_FORMAT = 'DD/MM/RR'",
            "ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'DD-MON-RR HH24:MI:SSXFF'",
            "ALTER SESSION SET NLS_TIMESTAMP_TZ_FORMAT = 'DD-MON-RR HH24:MI:SSXFF TZH:TZM'",
          ],
        }
      );

      expect(rows).toEqual([
        {
          date_value: '2026-07-16 12:30:45',
          timestamp_value: '2026-07-16 12:30:45.123',
          timestamp_tz_value: '2026-07-16T09:30:45.123Z',
          timestamp_ltz_value: '2026-07-16T09:30:45.123Z',
        },
      ]);
    } finally {
      await kit.destroy();
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

      const insertResult = await dataSource
        .createQueryBuilder()
        .insert()
        .into(IntegrationAuditLogEntity)
        .values({
          id: 4,
          status: 'inserted',
          updatedAt: new Date('2026-01-04T00:00:00.456Z'),
          version: 1,
        })
        .returning(['ID', 'STATUS', 'UPDATED_AT'])
        .execute();
      const updateResult = await dataSource
        .createQueryBuilder()
        .update(IntegrationAuditLogEntity)
        .set({ status: 'processed' })
        .where('ID = :id', { id: 1 })
        .returning(['STATUS', 'ROW_VERSION'])
        .execute();
      await dataSource
        .createQueryBuilder()
        .softDelete()
        .from(IntegrationAuditLogEntity)
        .where('ID = :id', { id: 2 })
        .execute();
      const deleteResult = await dataSource
        .createQueryBuilder()
        .delete()
        .from(IntegrationAuditLogEntity)
        .where('ID = :id', { id: 3 })
        .returning(['ID', 'STATUS'])
        .execute();

      const flattenReturnedValues = (raw: unknown): Array<unknown> => {
        if (!Array.isArray(raw)) return [raw];
        const rawValues = raw as Array<unknown>;
        const returnedValues: Array<unknown> = [];
        for (const value of rawValues) {
          if (Array.isArray(value)) {
            const nestedValues = value as Array<unknown>;
            for (const nestedValue of nestedValues)
              returnedValues.push(nestedValue);
          } else {
            returnedValues.push(value);
          }
        }
        return returnedValues;
      };
      const insertedValues = flattenReturnedValues(insertResult.raw);
      const updatedValues = flattenReturnedValues(updateResult.raw);
      const deletedValues = flattenReturnedValues(deleteResult.raw);
      expect(insertedValues).toContain('inserted');
      expect(insertedValues.map(Number)).toContain(4);
      expect(insertedValues.some((value) => value instanceof Date)).toBe(true);
      expect(updatedValues).toContain('processed');
      expect(updatedValues.map(Number)).toContain(2);
      expect(deletedValues).toContain('stale');
      expect(deletedValues.map(Number)).toContain(3);

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

      expect(rows).toHaveLength(3);
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
      expect(rows[2]).toMatchObject({
        id: 4,
        status: 'inserted',
        deleted_at: null,
        row_version: 1,
      });
    } finally {
      if (dataSource.isInitialized) {
        await dropOracleQueryBuilderFixture(dataSource);
        await dataSource.destroy();
      }
    }
  });

  it('persists and hydrates a temporal entity through a real Oracle repository', async (): Promise<void> => {
    const dataSource = createOracleQueryBuilderDataSource(settings!);
    const createdAt = new Date('2026-01-05T12:30:45.678Z');

    try {
      await dataSource.initialize();
      await createOracleQueryBuilderFixture(dataSource);

      const repository = dataSource.getRepository(
        IntegrationMessageAuditEntity
      );
      await repository.save(
        repository.create({
          id: 99,
          messageUuid: 'm-1',
          createdAt,
        })
      );

      const hydrated = await repository.findOneByOrFail({ id: 99 });
      expect(hydrated).toBeInstanceOf(IntegrationMessageAuditEntity);
      expect(hydrated.createdAt).toBeInstanceOf(Date);
      expect(hydrated.createdAt.getTime()).toBe(createdAt.getTime());
    } finally {
      if (dataSource.isInitialized) {
        await dropOracleQueryBuilderFixture(dataSource);
        await dataSource.destroy();
      }
    }
  });
});
