import { describe, expect, it, vi } from 'vitest';

import { DbQueryResultCache } from '../../src/typeorm/cache/db-query-result-cache.js';
import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import type { QueryRunner } from '../../src/typeorm/query-runner/QueryRunner.js';

function createCache(queryRunner: QueryRunner): {
  cache: DbQueryResultCache;
  createQueryRunner: ReturnType<typeof vi.fn>;
} {
  const createQueryRunner = vi.fn(() => queryRunner);
  const connection = {
    driver: {
      options: { type: 'postgres' },
      database: 'database',
      schema: 'public',
      buildTableName: vi.fn(() => 'public.query-result-cache'),
    },
    createQueryRunner,
  } as unknown as DataSource;

  return {
    cache: new DbQueryResultCache(connection),
    createQueryRunner,
  };
}

describe('DbQueryResultCache query runner ownership', (): void => {
  it('creates a master runner and releases it after success', async (): Promise<void> => {
    const queryRunner = {
      clearTable: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    const { cache, createQueryRunner } = createCache(queryRunner);

    await cache.clearCacheTable();

    expect(createQueryRunner).toHaveBeenCalledWith('master');
    expect(queryRunner.clearTable).toHaveBeenCalledWith(
      'public.query-result-cache'
    );
    expect(queryRunner.release).toHaveBeenCalledOnce();
  });

  it('releases an owned runner when the operation fails', async (): Promise<void> => {
    const error = new Error('clear failed');
    const queryRunner = {
      clearTable: vi.fn().mockRejectedValue(error),
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    const { cache } = createCache(queryRunner);

    await expect(cache.clearCacheTable()).rejects.toBe(error);
    expect(queryRunner.release).toHaveBeenCalledOnce();
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
    const queryRunner = {
      clearTable: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
    const { cache, createQueryRunner } = createCache(queryRunner);

    await cache.clearCacheTable(queryRunner);

    expect(createQueryRunner).not.toHaveBeenCalled();
    expect(queryRunner.release).not.toHaveBeenCalled();
  });
});
