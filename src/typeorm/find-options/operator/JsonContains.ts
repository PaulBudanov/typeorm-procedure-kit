import { FindOperator } from '../FindOperator.js';

/**
 * FindOptions Operator.
 * Example: { someField: JsonContains({...}) }
 */
export function JsonContains<
  T extends Record<string | number | symbol, unknown>,
>(value: T | FindOperator<T>): FindOperator<unknown> {
  return new FindOperator('jsonContains', value as unknown);
}
