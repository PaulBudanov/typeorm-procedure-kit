export type {
  ICaseStrategyFactory,
  IColumnNameTransformStrategy,
} from '../interfaces/strategy.interfaces.js';

/** Supported output key casing modes for ORM and native query results. */
export type TKeyTransformCase = 'camelCase' | 'lowerCase' | 'snakeCase';
