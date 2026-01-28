import { DefaultNamingStrategy } from 'typeorm';

import { DatabaseNamingCache } from '../utils/database-naming-cache.js';
import { StringUtilities } from '../utils/string-utilities.js';

export class LowerCaseNamingStrategy extends DefaultNamingStrategy {
  private databaseNamingCache = new DatabaseNamingCache();
  /**
   * Creates a new instance of the LowerCaseNamingStrategy class.
   * @param {symbol} columnNameCacheKey - Cache key for column name.
   */
  public constructor(private columnNameCacheKey: symbol) {
    super();
  }
  public columnName(
    propertyName: string,
    customName: string,
    embeddedPrefixes: Array<string>,
  ): string {
    // console.log(propertyName, customName, embeddedPrefixes);
    const name = StringUtilities.toLowerCase(customName ?? propertyName);
    if (this.databaseNamingCache.cacheHas(this.columnNameCacheKey, name))
      return this.databaseNamingCache.cacheGet(this.columnNameCacheKey, name)!;
    const data = super.columnName(name, name, embeddedPrefixes);
    this.databaseNamingCache.cacheSet(this.columnNameCacheKey, name, data);
    return data;
  }
}
