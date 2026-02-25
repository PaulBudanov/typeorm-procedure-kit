import { FindOperator } from '../FindOperator.js';

/**
 * FindOptions Operator.
 * Example: { someField: ArrayOverlap([...]) }
 */
export function ArrayOverlap<T>(
  value: ReadonlyArray<T> | FindOperator<T>
): FindOperator<T> {
  return new FindOperator('arrayOverlap', value as T);
}
