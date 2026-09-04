import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgreUnnamedPortalError } from '../../src/adapters/postgres/postgre-portal-name.js';
import { TypeOrmProcedureKit } from '../../src/index.js';

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

import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';

const settings = createPostgresIntegrationSettings();
const replicationSettings = createPostgresReplicationIntegrationSettings();
const procedureSchema = 'tpk_it_proc' as const;

type TPostgresIntegrationSettings = NonNullable<
  ReturnType<typeof createPostgresIntegrationSettings>
>;

interface IPostgresDriverWithReplicationMethods {
  obtainMasterConnection: () => Promise<unknown>;
  obtainSlaveConnection: () => Promise<unknown>;
}

async function withPostgresClient<T>(
  integrationSettings: TPostgresIntegrationSettings,
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
  integrationSettings: TPostgresIntegrationSettings
): Promise<void> {
  await withPostgresClient(integrationSettings, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${procedureSchema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${procedureSchema}"`);
    await client.query(`
      CREATE TYPE "${procedureSchema}".profile_type AS (
        first_name text,
        created_at timestamp with time zone,
        tags text[]
      )
    `);
    await client.query(`
      CREATE TABLE "${procedureSchema}".account_row (
        account_id integer,
        display_name text
      )
    `);
    await client.query(`
      CREATE TYPE "${procedureSchema}".child_type AS (
        value text
      )
    `);
    await client.query(`
      CREATE TYPE "${procedureSchema}".nested_profile_type AS (
        child "${procedureSchema}".child_type
      )
    `);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".echo_values(
        IN p_value integer,
        IN p_label text,
        INOUT p_count integer,
        INOUT out_cursor refcursor,
        INOUT out_second_cursor refcursor
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        p_count := p_count + 1;
        OPEN out_cursor FOR
          SELECT
            (p_value + 1)::integer AS result,
            p_label AS label,
            'first'::text AS source;
        OPEN out_second_cursor FOR
          SELECT
            (p_value + 2)::integer AS result,
            p_label AS label,
            'second'::text AS source;
      END;
      $$;
    `);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".no_args()
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NULL;
      END;
      $$;
    `);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".named_out_cursor(
        OUT out_cursor refcursor
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        out_cursor := 'tpk_named_out_cursor';
        OPEN out_cursor FOR SELECT 42::integer AS result;
      END;
      $$;
    `);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".unnamed_out_cursor(
        OUT out_cursor refcursor
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        OPEN out_cursor FOR SELECT 42::integer AS result;
      END;
      $$;
    `);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".transform_profiles(
        IN p_input "${procedureSchema}".profile_type,
        INOUT p_state "${procedureSchema}".profile_type,
        OUT out_profile "${procedureSchema}".profile_type,
        OUT out_account "${procedureSchema}".account_row,
        IN p_values text[]
      )
      LANGUAGE plpgsql
      AS $$
      DECLARE
        previous_name text;
      BEGIN
        IF p_input IS NULL THEN
          p_state := NULL;
          out_profile := NULL;
          out_account := NULL;
          RETURN;
        END IF;

        previous_name := p_state.first_name;
        p_state := p_input;
        p_state.first_name := p_input.first_name || ':' || previous_name;
        p_state.tags := p_values;
        out_profile := p_input;
        out_account.account_id := 42;
        out_account.display_name := p_input.first_name;
      END;
      $$;
    `);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".consume_profile_array(
        IN profiles "${procedureSchema}".profile_type[]
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NULL;
      END;
      $$;
    `);
    await client.query(`
      CREATE PROCEDURE "${procedureSchema}".consume_nested_profile(
        IN p_value "${procedureSchema}".nested_profile_type
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NULL;
      END;
      $$;
    `);
  });
}

async function dropPostgresProcedureFixture(
  integrationSettings: TPostgresIntegrationSettings
): Promise<void> {
  await withPostgresClient(integrationSettings, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${procedureSchema}" CASCADE`);
  });
}

function createPostgresQueryBuilderDataSource(
  integrationSettings: TPostgresIntegrationSettings
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

      const result = await kit.call<{
        result: number;
        label: string;
        source: string;
      }>(`${procedureSchema}.echo_values`, {
        value: 41,
        label: 'procedure',
        count: 5,
      });

      expect(result).toEqual({
        rows: [
          { result: 42, label: 'procedure', source: 'first' },
          { result: 43, label: 'procedure', source: 'second' },
        ],
        outBinds: {
          p_count: 6,
          out_cursor: [{ result: 42, label: 'procedure', source: 'first' }],
          out_second_cursor: [
            { result: 43, label: 'procedure', source: 'second' },
          ],
        },
      });
    } finally {
      await kit.destroy();
      await dropPostgresProcedureFixture(settings!);
    }
  });

  it('supports no-argument and explicitly named pure OUT cursor procedures', async (): Promise<void> => {
    await createPostgresProcedureFixture(settings!);
    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        packagesSettings: {
          packages: [procedureSchema],
          procedureObjectList: {
            noArgs: `${procedureSchema}.no_args`,
            namedOutCursor: `${procedureSchema}.named_out_cursor`,
          },
        },
      },
    });

    try {
      await kit.initDatabase();
      await expect(kit.call(`${procedureSchema}.no_args`)).resolves.toEqual({
        rows: [],
        outBinds: {},
      });
      await expect(
        kit.call<{ result: number }>(`${procedureSchema}.named_out_cursor`)
      ).resolves.toEqual({
        rows: [{ result: 42 }],
        outBinds: { out_cursor: [{ result: 42 }] },
      });
    } finally {
      await kit.destroy();
      await dropPostgresProcedureFixture(settings!);
    }
  });

  it('rejects PostgreSQL-generated unnamed portals from pure OUT cursors', async (): Promise<void> => {
    await createPostgresProcedureFixture(settings!);
    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        packagesSettings: {
          packages: [procedureSchema],
          procedureObjectList: {
            unnamedOutCursor: `${procedureSchema}.unnamed_out_cursor`,
          },
        },
      },
    });

    try {
      await kit.initDatabase();
      await expect(
        kit.call(`${procedureSchema}.unnamed_out_cursor`)
      ).rejects.toThrow(PostgreUnnamedPortalError);
    } finally {
      await kit.destroy();
      await dropPostgresProcedureFixture(settings!);
    }
  });

  it('binds, materializes, and refreshes named composite metadata', async (): Promise<void> => {
    await createPostgresProcedureFixture(settings!);
    const kit = new TypeOrmProcedureKit({
      ...settings!,
      config: {
        ...settings!.config,
        outKeyTransformCase: 'camelCase',
        packagesSettings: {
          packages: [procedureSchema],
          procedureObjectList: {
            transformProfiles: `${procedureSchema}.transform_profiles`,
            consumeProfileArray: `${procedureSchema}.consume_profile_array`,
            consumeNestedProfile: `${procedureSchema}.consume_nested_profile`,
          },
          isNeedDynamicallyUpdatePackagesInfo: true,
        },
      },
    });
    let isSerializerRegistered = false;

    try {
      await kit.initDatabase();
      kit.setSerializer({
        serializerType: 'TIMESTAMP_TZ',
        strategy: ({ context }) => `serialized:${context?.name ?? 'unknown'}`,
      });
      isSerializerRegistered = true;

      const injectionPayload = `O'Reilly, (safe) $1; SELECT pg_sleep(10); --`;
      const result = await kit.call(`${procedureSchema}.transform_profiles`, {
        input: {
          firstName: injectionPayload,
          createdAt: new Date('2026-01-02T03:04:05.678Z'),
          tags: ['input,tag', '(input)'],
        },
        state: {
          firstName: 'before',
          createdAt: null,
          tags: [],
        },
        values: ['native,array', '(value)', '"quoted"'],
      });

      expect(result).toEqual({
        rows: [],
        outBinds: {
          pState: {
            firstName: `${injectionPayload}:before`,
            createdAt: 'serialized:createdAt',
            tags: ['native,array', '(value)', '"quoted"'],
          },
          outProfile: {
            firstName: injectionPayload,
            createdAt: 'serialized:createdAt',
            tags: ['input,tag', '(input)'],
          },
          outAccount: {
            accountId: 42,
            displayName: injectionPayload,
          },
        },
      });

      await expect(
        kit.call(`${procedureSchema}.transform_profiles`, {
          input: null,
          state: null,
          values: [],
        })
      ).resolves.toEqual({
        rows: [],
        outBinds: {
          pState: null,
          outProfile: null,
          outAccount: null,
        },
      });
      await expect(
        kit.call(`${procedureSchema}.transform_profiles`, {
          input: { firstName: 'invalid', unknownField: true },
          state: null,
          values: [],
        })
      ).rejects.toThrow('Unknown field "unknownField"');
      await expect(
        kit.call(`${procedureSchema}.consume_profile_array`, { profiles: [] })
      ).rejects.toThrow('PostgreSQL composite arrays are not supported');
      await expect(
        kit.call(`${procedureSchema}.consume_nested_profile`, {
          value: { child: { value: 'nested' } },
        })
      ).rejects.toThrow('Nested PostgreSQL composites are not supported');

      const refreshedPayload = {
        input: {
          firstName: 'refreshed',
          createdAt: new Date('2026-02-03T04:05:06.789Z'),
          tags: ['after'],
          extraNote: 'new metadata field',
        },
        state: { firstName: 'before refresh' },
        values: ['refreshed array'],
      };
      await expect(
        kit.call(`${procedureSchema}.transform_profiles`, refreshedPayload)
      ).rejects.toThrow('Unknown field "extraNote"');

      await withPostgresClient(settings!, async (client) => {
        await client.query(
          `ALTER TYPE "${procedureSchema}".profile_type ADD ATTRIBUTE extra_note text`
        );
        await client.query('SELECT pg_notify($1, $2)', [
          'db_object_event',
          JSON.stringify({ event: 'CREATE', object: procedureSchema }),
        ]);
      });

      await vi.waitFor(
        async () => {
          await expect(
            kit.call(`${procedureSchema}.transform_profiles`, refreshedPayload)
          ).resolves.toEqual({
            rows: [],
            outBinds: {
              pState: {
                firstName: 'refreshed:before refresh',
                createdAt: 'serialized:createdAt',
                tags: ['refreshed array'],
                extraNote: 'new metadata field',
              },
              outProfile: {
                firstName: 'refreshed',
                createdAt: 'serialized:createdAt',
                tags: ['after'],
                extraNote: 'new metadata field',
              },
              outAccount: {
                accountId: 42,
                displayName: 'refreshed',
              },
            },
          });
        },
        { timeout: 5000, interval: 50 }
      );
    } finally {
      if (isSerializerRegistered) kit.deleteAllSerializers();
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
          .driver as unknown as IPostgresDriverWithReplicationMethods;
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
