import type {
  ICaseStrategyFactory,
  TKeyTransformCase,
} from '../types/strategy.types.js';
import { DatabaseNamingCache } from '../utils/database-naming-cache.js';
import { StringUtilities } from '../utils/string-utilities.js';

import { OrmStrategy } from './orm-strategy.js';

export abstract class CaseStrategyFactory {
  private static TRANSFORM_STRATEGIES: Record<
    TKeyTransformCase,
    (str: string) => string
  > = {
    camelCase: StringUtilities.toCamelCase,
    lowerCase: StringUtilities.toLowerCase,
    snakeCase: StringUtilities.toSnakeCase,
  };

  /**
   * Returns a shared case strategy with the specified transformation function.
   * The strategy is used both as a TypeORM naming strategy and as a raw result key transformer.
   * The default transformation function is StringUtilities.toCamelCase.
   * @param {TKeyTransformCase} [outKeyTransformCase='camelCase'] - The key to the transformation function.
   * @returns {ICaseStrategyFactory} - An instance of ICaseStrategyFactory with the specified transformation function.
   */
  public static caseStrategyFactory(
    outKeyTransformCase: TKeyTransformCase = 'camelCase'
  ): ICaseStrategyFactory {
    const transformFn =
      CaseStrategyFactory.TRANSFORM_STRATEGIES[outKeyTransformCase] ??
      StringUtilities.toCamelCase;
    const cacheKey = Symbol('columnNameCacheKey');
    const cache = new DatabaseNamingCache<string>();
    cache.createCache(cacheKey);

    return { strategy: new OrmStrategy(cacheKey, transformFn, cache) };
  }
}
