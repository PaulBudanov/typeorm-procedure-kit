import type { NativeStrategy } from '../case-strategy/native-strategy.js';
import type { OrmStrategy } from '../case-strategy/orm-strategy.js';

export interface INativeStrategyMethods {
  transformColumnName: (columnName: string) => string;
}

export interface ICaseStrategyFactory {
  strategy: OrmStrategy;
  nativeStrategy: NativeStrategy;
}

/**
 * @deprecated Use `ICaseStrategyFactory` instead.
 */
export type ICaseStratefyFactory = ICaseStrategyFactory;

export type TKeyTransformCase = 'camelCase' | 'lowerCase' | 'snakeCase';
