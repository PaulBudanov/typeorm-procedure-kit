import { FindOperator } from '../FindOperator.js';

/**
 * FindOptions Operator.
 * Example: { someField: ArrayContains([...]) }
 */
export function ArrayContains<T>(
  value: ReadonlyArray<T> | FindOperator<T>
): FindOperator<T> {
  return new FindOperator('arrayContains', value as T);
}
