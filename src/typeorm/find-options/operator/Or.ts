import { FindOperator } from '../FindOperator';

export function Or<T>(...values: Array<FindOperator<T>>): FindOperator<T> {
  return new FindOperator('or', values as any, true, true);
}
