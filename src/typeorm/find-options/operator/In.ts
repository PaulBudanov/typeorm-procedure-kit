import { FindOperator } from '../FindOperator.js';

/**
 * Find Options Operator.
 * Example: { someField: In([...]) }
 */
export function In<T>(
  value: ReadonlyArray<T> | FindOperator<T>
): FindOperator<T> {
  return new FindOperator('in', value as FindOperator<T>, true, true);
}
