import type { NamingStrategyInterface } from '../typeorm/index.js';
import { DefaultNamingStrategy } from '../typeorm/naming-strategy/DefaultNamingStrategy.js';
import type { DatabaseNamingCache } from '../utils/database-naming-cache.js';
import { ServerError } from '../utils/server-error.js';

//TODO: Extend NamingStrategy Class.
export class OrmStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  private databaseNamingCache: DatabaseNamingCache<string>;
  private readonly COLUMN_NAME_CACHE_KEY_SEPARATOR = '\x1f';
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
  public columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: Array<string>
  ): string {
    const columnName = propertyName ?? customName;
    if (typeof columnName !== 'string')
      throw new ServerError('Column name must be a string');
    const name = this.stringTransformUtility(columnName);
    let cacheName = `${name}${this.COLUMN_NAME_CACHE_KEY_SEPARATOR}${
      customName ?? ''
    }`;
    if (embeddedPrefixes.length)
      cacheName += `${this.COLUMN_NAME_CACHE_KEY_SEPARATOR}${embeddedPrefixes.join(
        this.COLUMN_NAME_CACHE_KEY_SEPARATOR
      )}`;
    if (this.databaseNamingCache.cacheHas(this.columnNameCacheKey, cacheName))
      return this.databaseNamingCache.cacheGet(
        this.columnNameCacheKey,
        cacheName
      )!;
    const data = super.columnName(name, customName, embeddedPrefixes);
    this.databaseNamingCache.cacheSet(this.columnNameCacheKey, cacheName, data);
    return data;
  }

  /**
   * Transforms raw column names and query aliases with the configured case utility.
   */
  public transformColumnName(columnName: string): string {
    if (typeof columnName !== 'string')
      throw new ServerError('Column name must be a string');
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
