import { FindOperator } from '../FindOperator.js';

/**
 * Find Options Operator.
 * Example: { someField: Like("%some string%") }
 */
export function Like<T>(value: T | FindOperator<T>): FindOperator<T> {
  return new FindOperator('like', value);
}
