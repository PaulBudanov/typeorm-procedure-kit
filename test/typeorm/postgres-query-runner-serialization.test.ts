import { describe, expect, it, vi } from 'vitest';

import { PostgresQueryRunner } from '../../src/typeorm/driver/postgres/PostgresQueryRunner.js';
import { TableCheck } from '../../src/typeorm/schema-builder/table/TableCheck.js';

describe('PostgresQueryRunner same-client serialization', (): void => {
  it('executes batched schema mutations one at a time', async (): Promise<void> => {
    const dataSource = { subscribers: [] } as Record<string, unknown>;
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
    };
    dataSource.driver = driver;
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');
    let activeQueries = 0;
    let maximumConcurrency = 0;
    const executionOrder: Array<string> = [];
    vi.spyOn(queryRunner, 'createCheckConstraint').mockImplementation(
      async (_table, check): Promise<void> => {
        activeQueries += 1;
        maximumConcurrency = Math.max(maximumConcurrency, activeQueries);
        executionOrder.push(check.name!);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        activeQueries -= 1;
      }
    );

    await queryRunner.createCheckConstraints('items', [
      new TableCheck({ name: 'first', expression: 'value > 0' }),
      new TableCheck({ name: 'second', expression: 'value < 10' }),
    ]);

    expect(maximumConcurrency).toBe(1);
    expect(executionOrder).toEqual(['first', 'second']);
  });
});
