import type { OrmStrategy } from '../case-strategy/orm-strategy.js';

export interface IColumnNameTransformStrategy {
  /**
   * Transforms a raw database column name to the configured output case.
   */
  transformColumnName: (columnName: string) => string;
}

export interface ICaseStrategyFactory {
  /**
   * Shared TypeORM naming and raw result strategy.
   */
  strategy: OrmStrategy;
}
