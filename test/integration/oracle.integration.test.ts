import { describe, expect, it } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';

import { createOracleIntegrationSettings } from './database-integration.helpers.js';

const settings = createOracleIntegrationSettings();

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
});
