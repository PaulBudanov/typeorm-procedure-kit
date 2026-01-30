import type { NativeStrategy } from '../case-strategy/native-strategy.js';
import type { OrmStrategy } from '../case-strategy/orm-strategy.js';

export interface INativeStrategyMethods {
  transformColumnName: (columnName: string) => string;
}

export interface ICaseStratefyFactory {
  strategy: OrmStrategy;
  nativeStrategy: NativeStrategy;
}

export type TKeyTransformCase = 'camelCase' | 'lowerCase' | 'snakeCase';
