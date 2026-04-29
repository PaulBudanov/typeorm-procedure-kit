import type { INativeStrategyMethods } from '../types/strategy.types.js';
import { DatabaseNamingCache } from '../utils/database-naming-cache.js';
import { ServerError } from '../utils/server-error.js';

export class NativeStrategy implements INativeStrategyMethods {
  private databaseNamingCache: DatabaseNamingCache<string>;
  /**
   * Constructor for the NativeStrategy class.
   * @param {symbol} columnNameCacheKey - Symbol to identify the cache key for the column name transformation.
   * @param {(columnName: string) => string} stringTransformUtility - Function to transform the column name.
   * @param {DatabaseNamingCache} [cacheClassInstance] - Optional instance of DatabaseNamingCache to use for caching.
   */
  public constructor(
    private columnNameCacheKey: symbol,
    private stringTransformUtility: (columnName: string) => string,
    private cacheClassInstance: DatabaseNamingCache<string>
  ) {
    this.databaseNamingCache = this.cacheClassInstance;
    if (!this.databaseNamingCache.cacheExists(this.columnNameCacheKey))
      this.columnNameCacheKey = this.databaseNamingCache.createCache(
        this.columnNameCacheKey
      );
  }

  /**
   * Transforms and caches a raw database column name with the configured case strategy.
   * @param columnName - Raw column name returned by the database driver.
   * @returns Column name transformed to the configured output case.
   */
  public transformColumnName(columnName: string): string {
    if (typeof columnName !== 'string')
      throw new ServerError('columnName must be a string');
    if (this.databaseNamingCache.cacheHas(this.columnNameCacheKey, columnName))
      return this.databaseNamingCache.cacheGet(
        this.columnNameCacheKey,
        columnName
      )!;
    const cacheData = this.stringTransformUtility(columnName);
    this.databaseNamingCache.cacheSet(
      this.columnNameCacheKey,
      columnName,
      cacheData
    );
    return cacheData;
  }

  public destroy(): void {
    this.cacheClassInstance.destroyCache();
  }
}
