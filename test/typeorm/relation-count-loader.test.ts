import { describe, expect, it, vi } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { RelationCountLoader } from '../../src/typeorm/query-builder/relation-count/RelationCountLoader.js';

import type { QueryRunner } from '../../src/typeorm/query-runner/QueryRunner.js';

function createRunner(): {
  dataSource: DataSource;
  query: ReturnType<typeof vi.fn>;
  queryRunner: QueryRunner;
} {
  const dataSource = new DataSource({ type: 'postgres' });
  const query = vi.fn().mockResolvedValue({
    records: [],
    raw: [],
    affected: 0,
  });
  const queryRunner = {
    isTransactionActive: false,
    query,
  } as unknown as QueryRunner;

  return { dataSource, query, queryRunner };
}

describe('RelationCountLoader value binding', (): void => {
  it('binds malicious many-to-many foreign keys and retains zero', async (): Promise<void> => {
    const { dataSource, query, queryRunner } = createRunner();
    const maliciousValue = `owner') OR 1=1 --`;
    const loader = new RelationCountLoader(dataSource, queryRunner, [
      {
        parentAlias: 'post',
        junctionAlias: 'post_tag',
        joinInverseSideMetadata: { tableName: 'TAG' },
        relation: {
          isOneToMany: false,
          isOwning: true,
          joinColumns: [{ referencedColumn: { databaseName: 'OWNER_ID' } }],
          inverseJoinColumns: [
            { referencedColumn: { databaseName: 'RELATED_ID' } },
          ],
          junctionEntityMetadata: {
            tableName: 'POST_TAG',
            columns: [
              { databaseName: 'OWNER_ID' },
              { databaseName: 'RELATED_ID' },
            ],
          },
        },
      },
    ] as never);

    await loader.load([
      { post_OWNER_ID: maliciousValue },
      { post_OWNER_ID: 0 },
      { post_OWNER_ID: maliciousValue },
      { post_OWNER_ID: null },
      { post_OWNER_ID: undefined },
    ]);

    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain('IN ($1, $2)');
    expect(sql).not.toContain(maliciousValue);
    expect(parameters).toEqual([maliciousValue, 0]);
  });

  it('retains zero in the one-to-many reference set', async (): Promise<void> => {
    const { dataSource, query, queryRunner } = createRunner();
    const loader = new RelationCountLoader(dataSource, queryRunner, [
      {
        parentAlias: 'post',
        relation: {
          isOneToMany: true,
          inverseRelation: {
            propertyName: 'parentId',
            joinColumns: [{ referencedColumn: { propertyName: 'id' } }],
          },
          inverseEntityMetadata: {
            target: 'CHILD',
            tableName: 'CHILD',
          },
        },
      },
    ] as never);

    await loader.load([
      { post_id: 0 },
      { post_id: 0 },
      { post_id: null },
      { post_id: undefined },
    ]);

    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain('IN ($1)');
    expect(parameters).toEqual([0]);
  });
});
