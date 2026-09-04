import { DefaultNamingStrategy } from '../typeorm/naming-strategy/DefaultNamingStrategy.js';
import { ServerError } from '../utils/server-error.js';

import type { NamingStrategyInterface } from '../typeorm/index.js';
import type { DatabaseNamingCache } from '../utils/database-naming-cache.js';

//TODO: Extend NamingStrategy Class.
export class OrmStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  private databaseNamingCache: DatabaseNamingCache<string>;
  private static readonly COLUMN_NAME_CACHE_KEY_SEPARATOR = '\x1f';
  /**
   * Constructor for the OrmStrategy class.
   * @param {symbol} columnNameCacheKey - Symbol to identify the cache key for the column name transformation.
   * @param {(columnName: string) => string} stringTransformUtility - Function to transform the column name.
   * @param {DatabaseNamingCache} [cacheClassInstance] - Optional instance of DatabaseNamingCache to use for caching.
   */
  public constructor(
    private columnNameCacheKey: symbol,
    private stringTransformUtility: (columnName: string) => string,
    private cacheClassInstance: DatabaseNamingCache<string>
  ) {
    super();
    this.databaseNamingCache = this.cacheClassInstance;
    if (!this.databaseNamingCache.cacheExists(this.columnNameCacheKey))
      this.columnNameCacheKey = this.databaseNamingCache.createCache(
        this.columnNameCacheKey
      );
  }
  /**
   * Applies the configured case strategy to entity property names before
   * delegating to the default TypeORM column naming behavior.
   *
   * Explicit custom names are still passed to DefaultNamingStrategy so standard
   * TypeORM override behavior is preserved.
   *
   * @param propertyName - Entity property name.
   * @param customName - Optional custom column name from decorator metadata.
   * @param embeddedPrefixes - Embedded prefixes supplied by TypeORM.
   * @returns Database column name for ORM-generated SQL.
   */
  public override columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: Array<string>
  ): string {
    const columnName = propertyName;
    if (typeof columnName !== 'string')
      throw new ServerError('Column name must be a string');
    const name = this.stringTransformUtility(columnName);
    let cacheName = `${name}${OrmStrategy.COLUMN_NAME_CACHE_KEY_SEPARATOR}${customName}`;
    if (embeddedPrefixes.length)
      cacheName += `${OrmStrategy.COLUMN_NAME_CACHE_KEY_SEPARATOR}${embeddedPrefixes.join(
        OrmStrategy.COLUMN_NAME_CACHE_KEY_SEPARATOR
      )}`;
    const cachedColumnName = this.databaseNamingCache.cacheGet(
      this.columnNameCacheKey,
      cacheName
    );
    if (cachedColumnName !== undefined) return cachedColumnName;
    const data = super.columnName(name, customName, embeddedPrefixes);
    this.databaseNamingCache.cacheSet(this.columnNameCacheKey, cacheName, data);
    return data;
  }

  /**
   * Transforms raw column names and query aliases with the configured case utility.
   */
  public override transformColumnName(columnName: string): string {
    if (typeof columnName !== 'string')
      throw new ServerError('Column name must be a string');
    const cachedColumnName = this.databaseNamingCache.cacheGet(
      this.columnNameCacheKey,
      columnName
    );
    if (cachedColumnName !== undefined) return cachedColumnName;
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
