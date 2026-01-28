import type { INativeStrategyMethods } from '../../types.js';
import { DatabaseNamingCache } from '../utils/database-naming-cache.js';
import { StringUtilities } from '../utils/string-utilities.js';
//TODO: In future make factory for native strategies
export class LowerCaseNativeStrategy
  extends DatabaseNamingCache
  implements INativeStrategyMethods
{
  /**
   * Creates a new instance of the LowerCaseNativeStrategy class.
   * @param {symbol} columnNameCacheKey - Cache key for column name.
   */
  public constructor(private columnNameCacheKey: symbol) {
    super();
  }

  public transformColumnName(columnName: string): string {
    if (typeof columnName !== 'string')
      throw new Error('columnName must be a string');
    if (this.cacheHas(this.columnNameCacheKey, columnName))
      return this.cacheGet(this.columnNameCacheKey, columnName)!;
    const cacheData = StringUtilities.toLowerCase(columnName);
    this.cacheSet(this.columnNameCacheKey, columnName, cacheData);
    return cacheData;
  }
}
