import { randomUUID } from 'crypto';

import oracledb from 'oracledb';
import { beforeAll, describe, expect, it } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';

import { createOracleIntegrationSettings } from './database-integration.helpers.js';

const settings = createOracleIntegrationSettings();

describe.skipIf(!settings)(
  'Oracle package metadata integration (11g compatible fixture)',
  () => {
    beforeAll((): void => {
      const libraryPath = settings?.config.libraryPath;
      if (libraryPath && oracledb.thin)
        oracledb.initOracleClient({ libDir: libraryPath });
    });

    it('loads ordered scalar/cursor arguments, empty procedures and overload identities while excluding functions', async (): Promise<void> => {
      if (!settings) throw new Error('Oracle integration settings are missing');
      const credentials = settings.config.master;
      const connection = await oracledb.getConnection({
        user: credentials.username,
        password: credentials.password,
        connectString: `${credentials.host}:${credentials.port}/${credentials.database}`,
      });
      const packageName = `TPK_META_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      let isPackageCreated = false;
      try {
        await connection.execute(`
        CREATE PACKAGE ${packageName} AS
          PROCEDURE ECHO(P_ID IN NUMBER, OUT_ROWS OUT SYS_REFCURSOR, P_LABEL IN OUT VARCHAR2);
          PROCEDURE PING;
          PROCEDURE OVERLOADED(P_ID IN NUMBER);
          PROCEDURE OVERLOADED(P_LABEL IN VARCHAR2);
          FUNCTION READ_VALUE RETURN NUMBER;
          FUNCTION COMPUTE_VALUE(P_ID IN NUMBER) RETURN NUMBER;
        END ${packageName};
      `);
        isPackageCreated = true;
        await connection.execute(`
        CREATE PACKAGE BODY ${packageName} AS
          PROCEDURE ECHO(P_ID IN NUMBER, OUT_ROWS OUT SYS_REFCURSOR, P_LABEL IN OUT VARCHAR2) IS
          BEGIN OPEN OUT_ROWS FOR SELECT P_ID AS ID FROM DUAL; END;
          PROCEDURE PING IS BEGIN NULL; END;
          PROCEDURE OVERLOADED(P_ID IN NUMBER) IS BEGIN NULL; END;
          PROCEDURE OVERLOADED(P_LABEL IN VARCHAR2) IS BEGIN NULL; END;
          FUNCTION READ_VALUE RETURN NUMBER IS BEGIN RETURN 1; END;
          FUNCTION COMPUTE_VALUE(P_ID IN NUMBER) RETURN NUMBER IS BEGIN RETURN P_ID; END;
        END ${packageName};
      `);
        const dataSource = new DataSource({ type: 'oracle' });
        dataSource.driver.version = connection.oracleServerVersionString;
        const adapter = new OracleAdapter(dataSource, settings.logger.module, {
          isNeedRegisterDefaultSerializers: false,
          caseStrategy: { transformColumnName: (name: string): string => name },
          resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxMetadataRows: 20 },
        });
        const result = await connection.execute<Record<string, unknown>>(
          adapter.generatePackageInfoSql(packageName),
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const rows = result.rows ?? [];
        expect(rows.map((row) => row.procedure_name)).toEqual([
          'ECHO',
          'ECHO',
          'ECHO',
          'OVERLOADED',
          'OVERLOADED',
          'PING',
        ]);
        expect(
          rows
            .slice(0, 3)
            .map((row) => [
              row.argument_name,
              row.order,
              row.argument_type,
              row.mode,
            ])
        ).toEqual([
          ['P_ID', 1, 'NUMBER', 'IN'],
          ['OUT_ROWS', 2, 'REF CURSOR', 'OUT'],
          ['P_LABEL', 3, 'VARCHAR2', 'IN/OUT'],
        ]);
        expect(
          new Set(rows.slice(3, 5).map((row) => row.subprogram_id)).size
        ).toBe(2);
        expect(rows[5]).toMatchObject({
          argument_name: '__TPK_NO_ARGUMENT__',
          order: 0,
          size: null,
          argument_type: 'VOID',
        });
        const limitedAdapter = new OracleAdapter(
          dataSource,
          settings.logger.module,
          {
            isNeedRegisterDefaultSerializers: false,
            caseStrategy: {
              transformColumnName: (name: string): string => name,
            },
            resourceLimits: { ...DEFAULT_RESOURCE_LIMITS, maxMetadataRows: 1 },
          }
        );
        const limited = await connection.execute<Record<string, unknown>>(
          limitedAdapter.generatePackageInfoSql(packageName),
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        expect(limited.rows).toEqual(rows.slice(0, 2));
      } finally {
        try {
          if (isPackageCreated)
            await connection.execute(`DROP PACKAGE ${packageName}`);
        } finally {
          await connection.close();
        }
      }
    });
  }
);
