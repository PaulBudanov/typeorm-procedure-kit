import { FindOperator } from '../FindOperator.js';

export function And<T>(...values: Array<FindOperator<T>>): FindOperator<T> {
  return new FindOperator('and', values as T, true, true);
}
