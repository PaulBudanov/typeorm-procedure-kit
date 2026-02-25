import { FindOperator } from '../FindOperator.js';

/**
 * Find Options Operator.
 * Example: { someField: MoreThanOrEqual(10) }
 */
export function MoreThanOrEqual<T>(
  value: T | FindOperator<T>
): FindOperator<T> {
  return new FindOperator('moreThanOrEqual', value);
}
