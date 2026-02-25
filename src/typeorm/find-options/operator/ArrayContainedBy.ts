import { FindOperator } from '../FindOperator.js';

/**
 * FindOptions Operator.
 * Example: { someField: ArrayContainedBy([...]) }
 */
export function ArrayContainedBy<T>(
  value: ReadonlyArray<T> | FindOperator<T>
): FindOperator<T> {
  return new FindOperator('arrayContainedBy', value as T);
}
