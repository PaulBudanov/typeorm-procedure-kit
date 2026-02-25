import { FindOperator } from '../FindOperator.js';

export function Or<T>(...values: Array<FindOperator<T>>): FindOperator<T> {
  return new FindOperator<T>(
    'or',
    values as unknown as FindOperator<T>,
    true,
    true
  );
}
