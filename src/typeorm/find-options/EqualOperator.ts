import { FindOperator } from './FindOperator.js';

export class EqualOperator<T> extends FindOperator<T> {
  public override readonly '@instanceof' = Symbol.for('EqualOperator');

  public constructor(value: T | FindOperator<T>) {
    super('equal', value);
  }
}
