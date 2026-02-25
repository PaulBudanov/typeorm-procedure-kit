import { FindOperator } from '../FindOperator.js';

/**
 * Find Options Operator.
 * Example: { someField: Any([...]) }
 */
export function Any<T>(
  value: ReadonlyArray<T> | FindOperator<T>
): FindOperator<T> {
  return new FindOperator('any', value as T);
}
