import type { INativeStrategyMethods } from '../types/strategy.types.js';
import { DatabaseNamingCache } from '../utils/database-naming-cache.js';

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
    private cacheClassInstance?: DatabaseNamingCache<string>
  ) {
    this.databaseNamingCache =
      this.cacheClassInstance ?? new DatabaseNamingCache();
    if (!this.databaseNamingCache.cacheExists(this.columnNameCacheKey))
      this.columnNameCacheKey = this.databaseNamingCache.createCache(
        this.columnNameCacheKey
      );
  }

  public transformColumnName(columnName: string): string {
    if (typeof columnName !== 'string')
      throw new Error('columnName must be a string');
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
}
