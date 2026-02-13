import type { QueryRunner } from '../query-runner/QueryRunner.js';

export interface QueryResultCache {
  synchronize(queryRunner?: QueryRunner): Promise<void>;

  getFromCache(
    options: QueryResultCacheOptions,
    queryRunner?: QueryRunner
  ): Promise<QueryResultCacheOptions | void>;

  storeInCache(
    savedCache: QueryResultCacheOptions | void,
    queryRunner?: QueryRunner
  ): Promise<void>;

  isExpired(savedCache: QueryResultCacheOptions): boolean;

  clearCacheTable(queryRunner?: QueryRunner): Promise<void>;

  removeCacheData(
    identifiers: Array<string>,
    queryRunner?: QueryRunner
  ): Promise<void>;
}

/**
 * Options passed to QueryResultCache class.
 */
export interface QueryResultCacheOptions {
  /**
   * Cache identifier set by user.
   * Can be empty.
   */
  identifier?: string;

  /**
   * Time, when cache was created.
   */
  time?: number;

  /**
   * Duration in milliseconds during which results will be returned from cache.
   */
  duration: number;

  /**
   * Cached query.
   */
  query?: string;

  /**
   * Query result that will be cached.
   */
  result?: unknown;
}
