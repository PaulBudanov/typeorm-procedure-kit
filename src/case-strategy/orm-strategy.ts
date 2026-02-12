import { DefaultNamingStrategy } from 'typeorm';

import { DatabaseNamingCache } from '../utils/database-naming-cache.js';
import { ServerError } from '../utils/server-error.js';

//TODO: Extend NamingStrategy Class.
export class OrmStrategy extends DefaultNamingStrategy {
  private databaseNamingCache: DatabaseNamingCache<string>;

  /**
   * Constructor for the OrmStrategy class.
   * @param {symbol} columnNameCacheKey - Symbol to identify the cache key for the column name transformation.
   * @param {(columnName: string) => string} stringTransformUtility - Function to transform the column name.
   * @param {DatabaseNamingCache} [cacheClassInstance] - Optional instance of DatabaseNamingCache to use for caching.
   */
  public constructor(
    private columnNameCacheKey: symbol,
    private stringTransformUtility: (columnName: string) => string,
    private cacheClassInstance?: DatabaseNamingCache<string>
  ) {
    super();
    this.databaseNamingCache =
      this.cacheClassInstance ?? new DatabaseNamingCache();
    if (!this.databaseNamingCache.cacheExists(this.columnNameCacheKey))
      this.columnNameCacheKey = this.databaseNamingCache.createCache(
        this.columnNameCacheKey
      );
  }
  public columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: Array<string>
  ): string {
    const columnName = customName ?? propertyName;
    if (typeof columnName !== 'string')
      throw new ServerError('Column name must be a string');
    const name = this.stringTransformUtility(columnName);
    if (this.databaseNamingCache.cacheHas(this.columnNameCacheKey, name))
      return this.databaseNamingCache.cacheGet(this.columnNameCacheKey, name)!;
    const data = super.columnName(name, name, embeddedPrefixes);
    this.databaseNamingCache.cacheSet(this.columnNameCacheKey, name, data);
    return data;
  }
}
