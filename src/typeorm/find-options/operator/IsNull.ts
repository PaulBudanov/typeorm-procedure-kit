import { FindOperator } from '../FindOperator.js';

/**
 * Find Options Operator.
 * Example: { someField: IsNull() }
 */
export function IsNull(): FindOperator<undefined> {
  return new FindOperator('isNull', undefined, false);
}
