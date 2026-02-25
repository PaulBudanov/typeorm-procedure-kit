import { FindOperator } from './FindOperator.js';

export class EqualOperator<T> extends FindOperator<T> {
  public readonly '@instanceof' = Symbol.for('EqualOperator');

  public constructor(value: T | FindOperator<T>) {
    super('equal', value);
  }
}
