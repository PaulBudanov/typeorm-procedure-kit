import { describe, expect, it } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';

import { createPostgresIntegrationSettings } from './database-integration.helpers.js';

const settings = createPostgresIntegrationSettings();

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
});
