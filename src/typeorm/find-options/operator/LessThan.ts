import { FindOperator } from '../FindOperator.js';

/**
 * Find Options Operator.
 * Example: { someField: LessThan(10) }
 */
export function LessThan<T>(value: T | FindOperator<T>): FindOperator<T> {
  return new FindOperator('lessThan', value);
}
