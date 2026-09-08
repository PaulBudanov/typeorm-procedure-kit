import { describe, expect, it, vi } from 'vitest';

import { DbQueryResultCache } from '../../src/typeorm/cache/db-query-result-cache.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';

import type { EntityManager } from '../../src/typeorm/entity-manager/EntityManager.js';
import type { QueryRunner } from '../../src/typeorm/query-runner/QueryRunner.js';

type TCacheDatabaseType = 'oracle' | 'postgres';

function createSqlCache(
  type: TCacheDatabaseType,
  identifierQuoting: 'disabled' | 'enabled',
  tableName?: string
): {
  cache: DbQueryResultCache;
  query: ReturnType<typeof vi.fn>;
  queryRunner: QueryRunner;
  createTable: ReturnType<typeof vi.fn>;
  hasTable: ReturnType<typeof vi.fn>;
} {
  const dataSource = new DataSource({
    type,
    schema: 'APP',
    identifierQuoting,
    cache: tableName ? { type: 'database', tableName } : true,
  });
  const query = vi.fn().mockResolvedValue({
    records: [],
    raw: [],
    affected: 0,
  });
  const createTable = vi.fn().mockResolvedValue(undefined);
  const hasTable = vi.fn().mockResolvedValue(false);
  const mutableQueryRunner = {
    query,
    createTable,
    hasTable,
    getReplicationMode: vi.fn(() => 'master'),
    isTransactionActive: false,
    manager: undefined as unknown as EntityManager,
  };
  const queryRunner = mutableQueryRunner as unknown as QueryRunner;
  mutableQueryRunner.manager = dataSource.createEntityManager(queryRunner);
  const cache = dataSource.queryResultCache;
  if (!(cache instanceof DbQueryResultCache)) {
    throw new Error('Expected the database query result cache provider');
  }

  return { cache, query, queryRunner, createTable, hasTable };
}

function createCache(queryRunner: QueryRunner): {
  cache: DbQueryResultCache;
  createQueryRunner: ReturnType<typeof vi.fn>;
} {
  const createQueryRunner = vi.fn(() => queryRunner);
  const connection = {
    options: { type: 'postgres' },
    identifierQuoting: 'disabled',
    driver: {
      options: { type: 'postgres' },
      database: 'database',
      schema: 'public',
      buildTableName: vi.fn(() => 'public.query_result_cache'),
      escape: vi.fn((value: string) => `"${value}"`),
    },
    createQueryRunner,
  } as unknown as DataSource;

  return {
    cache: new DbQueryResultCache(connection),
    createQueryRunner,
  };
}

describe('DbQueryResultCache query runner ownership', (): void => {
  it('treats malformed cache timestamps and durations as expired', (): void => {
    const { cache } = createCache({} as QueryRunner);
    const cacheEntry = (
      time: unknown,
      duration: unknown
    ): Parameters<DbQueryResultCache['isExpired']>[0] =>
      ({ time, duration }) as Parameters<DbQueryResultCache['isExpired']>[0];

    expect(cache.isExpired(cacheEntry('invalid', 1000))).toBe(true);
    expect(cache.isExpired(cacheEntry('100junk', 1000))).toBe(true);
    expect(cache.isExpired(cacheEntry(Date.now(), -1))).toBe(true);
    expect(cache.isExpired(cacheEntry('', 1000))).toBe(true);
    expect(cache.isExpired(cacheEntry(Date.now(), 60_000))).toBe(false);
    expect(cache.isExpired(cacheEntry(0, 1))).toBe(true);
  });

  it('creates a master runner and releases it after success', async (): Promise<void> => {
    const clearTable = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const queryRunner = {
      clearTable,
      getReplicationMode: vi.fn(() => 'master'),
      release,
    } as unknown as QueryRunner;
    const { cache, createQueryRunner } = createCache(queryRunner);

    await cache.clearCacheTable();

    expect(createQueryRunner).toHaveBeenCalledWith('master');
    expect(clearTable).toHaveBeenCalledWith('public.query_result_cache');
    expect(release).toHaveBeenCalledOnce();
  });

  it('uses and releases a new master runner when a replica is supplied', async (): Promise<void> => {
    const masterClearTable = vi.fn().mockResolvedValue(undefined);
    const masterRelease = vi.fn().mockResolvedValue(undefined);
    const replicaClearTable = vi.fn().mockResolvedValue(undefined);
    const replicaRelease = vi.fn().mockResolvedValue(undefined);
    const masterRunner = {
      clearTable: masterClearTable,
      release: masterRelease,
    } as unknown as QueryRunner;
    const replicaRunner = {
      clearTable: replicaClearTable,
      getReplicationMode: vi.fn(() => 'slave'),
      release: replicaRelease,
    } as unknown as QueryRunner;
    const { cache, createQueryRunner } = createCache(masterRunner);

    await cache.clearCacheTable(replicaRunner);

    expect(createQueryRunner).toHaveBeenCalledWith('master');
    expect(masterClearTable).toHaveBeenCalledOnce();
    expect(masterRelease).toHaveBeenCalledOnce();
    expect(replicaClearTable).not.toHaveBeenCalled();
    expect(replicaRelease).not.toHaveBeenCalled();
  });

  it('releases an owned runner when the operation fails', async (): Promise<void> => {
    const error = new Error('clear failed');
    const release = vi.fn().mockResolvedValue(undefined);
    const queryRunner = {
      clearTable: vi.fn().mockRejectedValue(error),
      release,
    } as unknown as QueryRunner;
    const { cache } = createCache(queryRunner);

    await expect(cache.clearCacheTable()).rejects.toBe(error);
    expect(release).toHaveBeenCalledOnce();
  });

  it('preserves both operation and release failures', async (): Promise<void> => {
    const operationError = new Error('clear failed');
    const releaseError = new Error('release failed');
    const queryRunner = {
      clearTable: vi.fn().mockRejectedValue(operationError),
      release: vi.fn().mockRejectedValue(releaseError),
    } as unknown as QueryRunner;
    const { cache } = createCache(queryRunner);

    let error: unknown;
    try {
      await cache.clearCacheTable();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      operationError,
      releaseError,
    ]);
    expect((error as Error & { cause?: unknown }).cause).toBe(operationError);
  });

  it('honors a supplied runner and never releases it', async (): Promise<void> => {
    const release = vi.fn().mockResolvedValue(undefined);
    const queryRunner = {
      clearTable: vi.fn().mockResolvedValue(undefined),
      getReplicationMode: vi.fn(() => 'master'),
      release,
    } as unknown as QueryRunner;
    const { cache, createQueryRunner } = createCache(queryRunner);

    await cache.clearCacheTable(queryRunner);

    expect(createQueryRunner).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});

describe.each<TCacheDatabaseType>(['postgres', 'oracle'])(
  'DbQueryResultCache %s identifier quoting',
  (type): void => {
    it.each(['disabled', 'enabled'] as const)(
      'uses the safe default table consistently when quoting is %s',
      async (identifierQuoting): Promise<void> => {
        const { cache, query, queryRunner, createTable, hasTable } =
          createSqlCache(type, identifierQuoting);
        const cacheOptions = {
          identifier: 'entry',
          query: 'SELECT 1',
          time: Date.now(),
          duration: 1_000,
          result: '[]',
        };

        await cache.synchronize(queryRunner);
        await cache.getFromCache(
          { identifier: cacheOptions.identifier, duration: 1_000 },
          queryRunner
        );
        await cache.getFromCache(
          { query: cacheOptions.query, duration: 1_000 },
          queryRunner
        );
        await cache.storeInCache(cacheOptions, undefined, queryRunner);
        await cache.storeInCache(
          cacheOptions,
          { ...cacheOptions, query: undefined },
          queryRunner
        );
        await cache.storeInCache(
          { ...cacheOptions, identifier: undefined },
          { ...cacheOptions, identifier: undefined },
          queryRunner
        );
        await cache.removeCacheData([cacheOptions.identifier], queryRunner);

        const tableName =
          identifierQuoting === 'enabled'
            ? '"APP"."query_result_cache"'
            : 'APP.query_result_cache';
        const identifierColumn =
          identifierQuoting === 'enabled' ? '"identifier"' : 'identifier';
        const queryColumn =
          identifierQuoting === 'enabled' ? '"query"' : 'query';
        const queries = query.mock.calls.map(([sql]) => sql as string);

        expect(hasTable).toHaveBeenCalledWith('APP.query_result_cache');
        expect(createTable).toHaveBeenCalledOnce();
        expect(queries[0]).toContain(`FROM ${tableName} "cache"`);
        expect(queries[0]).toContain(`"cache".${identifierColumn}`);
        expect(queries[1]).toContain(`"cache".${queryColumn}`);
        expect(queries[2]).toContain(`INSERT INTO ${tableName}`);
        expect(queries[3]).toContain(`UPDATE ${tableName}`);
        expect(queries[3]).toContain(`${identifierColumn} =`);
        expect(queries[4]).toContain(`UPDATE ${tableName}`);
        expect(queries[4]).toContain(
          type === 'oracle'
            ? `dbms_lob.compare(${queryColumn},`
            : `${queryColumn} =`
        );
        expect(queries[5]).toContain(`DELETE FROM ${tableName}`);
        expect(queries[5]).toContain(`${identifierColumn} =`);
      }
    );

    it.each(['query-result-cache', 'custom cache'])(
      'rejects unsafe configured table %s when quoting is disabled',
      (tableName): void => {
        expect(() => createSqlCache(type, 'disabled', tableName)).toThrow(
          'Unsafe unquoted SQL identifier'
        );
      }
    );

    it.each(['query-result-cache', 'custom cache'])(
      'quotes configured table %s when quoting is enabled',
      async (tableName): Promise<void> => {
        const { cache, query, queryRunner } = createSqlCache(
          type,
          'enabled',
          tableName
        );

        await cache.getFromCache(
          { identifier: 'entry', duration: 1_000 },
          queryRunner
        );

        expect(query.mock.calls[0]?.[0]).toContain(
          `FROM "APP"."${tableName}" "cache"`
        );
      }
    );
  }
);
