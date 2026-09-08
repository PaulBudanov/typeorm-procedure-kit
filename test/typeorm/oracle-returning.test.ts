import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { EntitySchema } from '../../src/typeorm/entity-schema/EntitySchema.js';
import { InsertQueryBuilder } from '../../src/typeorm/query-builder/InsertQueryBuilder.js';
import { QueryResult } from '../../src/typeorm/query-runner/QueryResult.js';

import type { ObjectLiteral } from '../../src/typeorm/common/ObjectLiteral.js';
import type { ColumnMetadata } from '../../src/typeorm/metadata/ColumnMetadata.js';
import type { QueryRunner } from '../../src/typeorm/query-runner/QueryRunner.js';
import type { MockInstance } from 'vitest';

class MetadataDataSource extends DataSource {
  public buildTestMetadata(): Promise<void> {
    return this.buildMetadatas();
  }
}

class ReorderedInsertQueryBuilder extends InsertQueryBuilder<ObjectLiteral> {
  protected override getReturningColumns(): Array<ColumnMetadata> {
    return super.getReturningColumns().reverse();
  }
}

class PrimaryReturningInsertQueryBuilder extends InsertQueryBuilder<ObjectLiteral> {
  protected override getReturningColumns(): Array<ColumnMetadata> {
    return this.connection.getMetadata(auditSchema).primaryColumns;
  }
}

const auditSchema = new EntitySchema({
  name: 'ReturningAudit',
  tableName: 'RETURNING_AUDIT',
  columns: {
    id: { type: Number, name: 'ID', primary: true, generated: true },
    status: { type: String, name: 'STATUS' },
    updatedAt: { type: 'timestamp', name: 'UPDATED_AT', updateDate: true },
    version: { type: Number, name: 'ROW_VERSION', version: true },
    deletedAt: {
      type: 'timestamp',
      name: 'DELETED_AT',
      deleteDate: true,
      nullable: true,
    },
  },
});

async function createOracleDataSource(): Promise<DataSource> {
  const dataSource = new MetadataDataSource({
    type: 'oracle',
    entities: [auditSchema],
  });
  await dataSource.buildTestMetadata();
  return dataSource;
}

function mockExecution(
  dataSource: DataSource,
  raw: unknown,
  affected = 1
): {
  queryRunner: QueryRunner;
  query: MockInstance<QueryRunner['query']>;
} {
  const queryRunner = dataSource.createQueryRunner();
  const queryResult = new QueryResult();
  queryResult.raw = raw;
  queryResult.records = Array.isArray(raw) ? raw : [];
  queryResult.affected = affected;
  const query = vi.spyOn(queryRunner, 'query').mockResolvedValue(queryResult);
  return { queryRunner, query };
}

describe('Oracle RETURNING SQL and entity hydration', (): void => {
  const updatedAt = new Date('2026-09-07T08:00:00.000Z');

  it('hydrates automatic INSERT columns and preserves named raw results', async (): Promise<void> => {
    const dataSource = await createOracleDataSource();
    const { queryRunner, query } = mockExecution(dataSource, [
      [42],
      [updatedAt],
      [1],
      [null],
    ]);
    const entity = { status: 'ready' };
    const result = await dataSource
      .createQueryBuilder(queryRunner)
      .insert()
      .into(auditSchema)
      .values(entity)
      .execute();

    expect(query.mock.calls[0]?.[0]).toContain(
      'RETURNING ID, UPDATED_AT, ROW_VERSION, DELETED_AT INTO'
    );
    expect(result.raw).toEqual({
      ID: 42,
      UPDATED_AT: updatedAt,
      ROW_VERSION: 1,
      DELETED_AT: null,
    });
    expect(result.generatedMaps).toEqual([
      { id: 42, updatedAt, version: 1, deletedAt: null },
    ]);
    expect(entity).toEqual({
      id: 42,
      status: 'ready',
      updatedAt,
      version: 1,
      deletedAt: null,
    });
    expect(result.identifiers).toEqual([{ id: 42 }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      returning: ['status', 'id'],
      columns: 'STATUS, ID, UPDATED_AT, ROW_VERSION, DELETED_AT',
      outBinds: [['saved'], [42], [updatedAt], [1], [null]],
      bindTypes: [
        oracledb.DB_TYPE_VARCHAR,
        oracledb.DB_TYPE_NUMBER,
        oracledb.DB_TYPE_TIMESTAMP,
        oracledb.DB_TYPE_NUMBER,
        oracledb.DB_TYPE_TIMESTAMP,
      ],
    },
    {
      returning: ['ROW_VERSION', 'STATUS'],
      columns: 'ROW_VERSION, STATUS, ID, UPDATED_AT, DELETED_AT',
      outBinds: [[1], ['saved'], [42], [updatedAt], [null]],
      bindTypes: [
        oracledb.DB_TYPE_NUMBER,
        oracledb.DB_TYPE_VARCHAR,
        oracledb.DB_TYPE_NUMBER,
        oracledb.DB_TYPE_TIMESTAMP,
        oracledb.DB_TYPE_TIMESTAMP,
      ],
    },
  ])(
    'matches explicit INSERT order $columns including automatic columns',
    async ({ returning, columns, outBinds, bindTypes }): Promise<void> => {
      const dataSource = await createOracleDataSource();
      const { queryRunner, query } = mockExecution(dataSource, outBinds);
      const entity = { status: 'ready' };
      const result = await dataSource
        .createQueryBuilder(queryRunner)
        .insert()
        .into(auditSchema)
        .values(entity)
        .returning(returning)
        .execute();

      expect(query.mock.calls[0]?.[0]).toContain(`RETURNING ${columns} INTO`);
      expect(query.mock.calls[0]?.[1]).toEqual([
        'ready',
        ...bindTypes.map((type) => ({ dir: oracledb.BIND_OUT, type })),
      ]);
      expect(result.raw).toEqual({
        ID: 42,
        STATUS: 'saved',
        UPDATED_AT: updatedAt,
        ROW_VERSION: 1,
        DELETED_AT: null,
      });
      expect(result.generatedMaps).toEqual([
        { id: 42, status: 'saved', updatedAt, version: 1, deletedAt: null },
      ]);
      expect(entity).toEqual(result.generatedMaps[0]);
      expect(result.identifiers).toEqual([{ id: 42 }]);
    }
  );

  it.each([
    {
      raw: [[42]],
      error: 'Oracle RETURNING result does not match the requested columns',
    },
    {
      raw: [[42], updatedAt, [1], [null]],
      error: 'Oracle RETURNING column must contain an array of values',
    },
  ])(
    'rejects invalid RETURNING output before entity hydration: $error',
    async ({ raw, error }): Promise<void> => {
      const dataSource = await createOracleDataSource();
      const { queryRunner } = mockExecution(dataSource, raw);
      const entity = { status: 'ready' };

      await expect(
        dataSource
          .createQueryBuilder(queryRunner)
          .insert()
          .into(auditSchema)
          .values(entity)
          .execute()
      ).rejects.toThrow(error);
      expect(entity).toEqual({ status: 'ready' });
    }
  );

  it('uses overridden returning-column order for both INSERT SQL and hydration', async (): Promise<void> => {
    const dataSource = await createOracleDataSource();
    const { queryRunner, query } = mockExecution(dataSource, [
      ['saved'],
      [42],
      [updatedAt],
      [1],
      [null],
    ]);
    const result = await new ReorderedInsertQueryBuilder(
      dataSource,
      queryRunner
    )
      .into(auditSchema)
      .values({ status: 'ready' })
      .returning(['id', 'status'])
      .execute();

    expect(query.mock.calls[0]?.[0]).toContain(
      'RETURNING STATUS, ID, UPDATED_AT, ROW_VERSION, DELETED_AT INTO'
    );
    expect(result.generatedMaps[0]).toMatchObject({ id: 42, status: 'saved' });
    expect(result.identifiers).toEqual([{ id: 42 }]);
  });

  it('honors a returning-column override for a string RETURNING expression', async (): Promise<void> => {
    const dataSource = await createOracleDataSource();
    const { queryRunner, query } = mockExecution(dataSource, [[42]]);
    const entity = { status: 'ready' };
    const result = await new PrimaryReturningInsertQueryBuilder(
      dataSource,
      queryRunner
    )
      .into(auditSchema)
      .values(entity)
      .returning('ID')
      .execute();

    expect(query.mock.calls[0]?.[0]).toContain('RETURNING ID INTO');
    expect(result.raw).toEqual({ ID: 42 });
    expect(result.generatedMaps).toEqual([{ id: 42 }]);
    expect(result.identifiers).toEqual([{ id: 42 }]);
    expect(entity).toEqual({ id: 42, status: 'ready' });
  });

  it('hydrates an UPDATE whereEntity using explicit and automatic columns', async (): Promise<void> => {
    const dataSource = await createOracleDataSource();
    const { queryRunner, query } = mockExecution(dataSource, [
      [2],
      ['saved'],
      [updatedAt],
    ]);
    const entity = { id: 42, status: 'ready', version: 1 };
    const result = await dataSource
      .createQueryBuilder(queryRunner)
      .update(auditSchema)
      .set({ status: 'saved' })
      .whereEntity(entity)
      .returning(['ROW_VERSION', 'STATUS'])
      .execute();

    expect(query.mock.calls[0]?.[0]).toContain(
      'RETURNING ROW_VERSION, STATUS, UPDATED_AT INTO'
    );
    expect(result.raw).toEqual({
      ROW_VERSION: 2,
      STATUS: 'saved',
      UPDATED_AT: updatedAt,
    });
    expect(entity).toEqual({ id: 42, status: 'saved', updatedAt, version: 2 });
    expect(result.generatedMaps).toEqual([
      { status: 'saved', updatedAt, version: 2 },
    ]);
    expect(result.affected).toBe(1);
  });

  it.each(['softDelete', 'restore'] as const)(
    'hydrates %s whereEntity including explicit order and delete-date nulls',
    async (operation): Promise<void> => {
      const dataSource = await createOracleDataSource();
      const deletedAt = operation === 'softDelete' ? updatedAt : null;
      const { queryRunner, query } = mockExecution(dataSource, [
        [deletedAt],
        [42],
        [updatedAt],
        [2],
      ]);
      const entity = {
        id: 42,
        status: 'ready',
        version: 1,
        updatedAt: null,
        deletedAt: null,
      };
      const result = await dataSource
        .createQueryBuilder(queryRunner)
        [operation]()
        .from(auditSchema)
        .whereEntity(entity)
        .returning(['DELETED_AT', 'ID'])
        .execute();

      expect(query.mock.calls[0]?.[0]).toContain(
        'RETURNING DELETED_AT, ID, UPDATED_AT, ROW_VERSION INTO'
      );
      expect(result.raw).toEqual({
        DELETED_AT: deletedAt,
        ID: 42,
        UPDATED_AT: updatedAt,
        ROW_VERSION: 2,
      });
      expect(entity).toEqual({
        id: 42,
        status: 'ready',
        updatedAt,
        version: 2,
        deletedAt,
      });
      expect(result.generatedMaps).toEqual([
        { id: 42, updatedAt, version: 2, deletedAt },
      ]);
    }
  );

  it('keeps INSERT OUT bind arrays with updateEntity(false)', async (): Promise<void> => {
    const dataSource = await createOracleDataSource();
    const outBinds = [[42], ['saved']];
    const { queryRunner, query } = mockExecution(dataSource, outBinds);
    const entity = { status: 'ready' };
    const result = await dataSource
      .createQueryBuilder(queryRunner)
      .insert()
      .into(auditSchema)
      .values(entity)
      .returning(['id', 'status'])
      .updateEntity(false)
      .execute();

    expect(query.mock.calls[0]?.[0]).toContain('RETURNING ID, STATUS INTO');
    expect(result.raw).toBe(outBinds);
    expect(result.generatedMaps).toEqual([]);
    expect(result.identifiers).toEqual([]);
    expect(entity).toEqual({ status: 'ready' });
  });

  it('does not interpret string RETURNING using automatic columns', async (): Promise<void> => {
    const dataSource = await createOracleDataSource();
    const outBinds = [['saved']];
    const { queryRunner, query } = mockExecution(dataSource, outBinds);
    const entity = { id: 42, status: 'ready' };
    const result = await dataSource
      .createQueryBuilder(queryRunner)
      .insert()
      .into(auditSchema)
      .values(entity)
      .returning('STATUS INTO :status')
      .setParameter('status', { dir: 3003, type: 2001 })
      .execute();

    expect(query.mock.calls[0]?.[0]).toContain('RETURNING STATUS INTO :');
    expect(query.mock.calls[0]?.[0]).not.toContain('RETURNING ID,');
    expect(result.raw).toBe(outBinds);
    expect(result.generatedMaps).toEqual([{}]);
    expect(result.identifiers).toEqual([{ id: 42 }]);
    expect(entity).toEqual({ id: 42, status: 'ready' });
  });

  it('keeps Oracle multi-insert RETURNING disabled', async (): Promise<void> => {
    const dataSource = await createOracleDataSource();
    const { queryRunner, query } = mockExecution(dataSource, 2, 2);
    const entities = [
      { id: 41, status: 'ready' },
      { id: 42, status: 'ready' },
    ];
    const result = await dataSource
      .createQueryBuilder(queryRunner)
      .insert()
      .into(auditSchema)
      .values(entities)
      .returning(['id', 'status'])
      .execute();
    expect(query.mock.calls[0]?.[0]).not.toMatch(/\bRETURNING\b/u);
    expect(result.raw).toBe(2);
    expect(result.generatedMaps).toEqual([{}, {}]);
    expect(result.identifiers).toEqual([{ id: 41 }, { id: 42 }]);
    expect(entities).toEqual([
      { id: 41, status: 'ready' },
      { id: 42, status: 'ready' },
    ]);
  });
});
