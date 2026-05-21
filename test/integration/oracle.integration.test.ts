import oracledb from 'oracledb';
import { describe, expect, it } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';

import { createOracleIntegrationSettings } from './database-integration.helpers.js';

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
});
