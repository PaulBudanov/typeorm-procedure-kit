import type { WhereExpressionBuilder } from './WhereExpressionBuilder.js';

/**
 * Syntax sugar.
 * Allows to use brackets in WHERE expressions for better syntax.
 */
export class Brackets {
  public readonly '@instanceof' = Symbol.for('Brackets');

  /**
   * WHERE expression that will be taken into brackets.
   */
  public whereFactory: (qb: WhereExpressionBuilder) => unknown;

  /**
   * Given WHERE query builder that will build a WHERE expression that will be taken into brackets.
   */
  public constructor(whereFactory: (qb: WhereExpressionBuilder) => unknown) {
    this.whereFactory = whereFactory;
  }
}
