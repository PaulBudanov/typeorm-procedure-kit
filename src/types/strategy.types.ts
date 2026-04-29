import type { NativeStrategy } from '../case-strategy/native-strategy.js';
import type { OrmStrategy } from '../case-strategy/orm-strategy.js';

export interface INativeStrategyMethods {
  /**
   * Transforms a raw database column name to the configured output case.
   */
  transformColumnName: (columnName: string) => string;
}

export interface ICaseStrategyFactory {
  /**
   * TypeORM naming strategy used while building entity metadata and SQL.
   */
  strategy: OrmStrategy;
  /**
   * Native result strategy used by driver fetch hooks.
   */
  nativeStrategy: NativeStrategy;
}

/**
 * @deprecated Use `ICaseStrategyFactory` instead.
 */
export type ICaseStratefyFactory = ICaseStrategyFactory;

/**
 * Supported output key casing modes for ORM and native query results.
 */
export type TKeyTransformCase = 'camelCase' | 'lowerCase' | 'snakeCase';
