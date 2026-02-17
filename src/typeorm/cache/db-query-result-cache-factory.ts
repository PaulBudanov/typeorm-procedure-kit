import { DbQueryResultCache } from './db-query-result-cache.js';
import { DataSource } from '../data-source/DataSource.js';
import { TypeORMError } from '../error/TypeORMError.js';

/**
 * Caches query result into Redis database.
 */
export class DbQueryResultCacheFactory {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(protected connection: DataSource) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new query result cache based on connection options.
   */
  public create(): DbQueryResultCache {
    if (!this.connection.options.cache)
      throw new TypeORMError(
        `To use cache you need to enable it in connection options by setting cache: true or providing some caching options. Example: { host: ..., username: ..., cache: true }`
      );

    const cache = this.connection.options.cache;

    if (
      typeof cache === 'object' &&
      cache.provider &&
      typeof cache.provider === 'function'
    ) {
      return cache.provider(this.connection);
    }

    return new DbQueryResultCache(this.connection);
  }
}
