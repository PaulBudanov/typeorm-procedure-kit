import { FindOperator } from '../FindOperator.js';

/**
 * Find Options Operator.
 * Example: { someField: IsNull() }
 */
export function IsNull<T>(): FindOperator<T> {
  return new FindOperator<T>('isNull', undefined as unknown as T, false);
}
