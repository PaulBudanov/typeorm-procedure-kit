import type { ICaseStratefyFactory, TKeyTransformCase } from '../types.js';

import { CamelCaseNativeStrategy } from './native-strategy/camel-case-native-strategy.js';
import { LowerCaseNativeStrategy } from './native-strategy/lower-case-native-strategy.js';
import { CamelCaseNamingStrategy } from './orm-strategy/camel-case-naming-strategy.js';
import { LowerCaseNamingStrategy } from './orm-strategy/lower-case-naming-strategy.js';
import { DatabaseNamingCache } from './utils/database-naming-cache.js';

/**
 * Returns an object containing two strategies: one for TypeORM and one for native queries.
 * The returned strategies are determined by the outKeyTransformCase parameter.
 * If outKeyTransformCase is 'camelCase', the returned strategies will be CamelCaseNamingStrategy and CamelCaseNativeStrategy.
 * If outKeyTransformCase is 'lowerCase', the returned strategies will be LowerCaseNamingStrategy and LowerCaseNativeStrategy.
 * If outKeyTransformCase is neither 'camelCase' nor 'lowerCase', the returned strategies will default to CamelCaseNamingStrategy and CamelCaseNativeStrategy.
 * @param {TKeyTransformCase} outKeyTransformCase - The type of key transform case to use.
 * @returns {Object} An object containing two strategies: one for TypeORM and one for native queries.
 */
export function caseStrategyFactory(
  outKeyTransformCase: TKeyTransformCase,
): ICaseStratefyFactory {
  const columnNameCacheKey = DatabaseNamingCache.createCache(
    Symbol('columnNameCacheKey'),
  );
  switch (outKeyTransformCase) {
    case 'camelCase':
      return {
        strategy: new CamelCaseNamingStrategy(columnNameCacheKey),
        nativeStrategy: new CamelCaseNativeStrategy(columnNameCacheKey),
      };
    case 'lowerCase':
      return {
        strategy: new LowerCaseNamingStrategy(columnNameCacheKey),
        nativeStrategy: new LowerCaseNativeStrategy(columnNameCacheKey),
      };
    default:
      return {
        strategy: new CamelCaseNamingStrategy(columnNameCacheKey),
        nativeStrategy: new CamelCaseNativeStrategy(columnNameCacheKey),
      };
  }
}
