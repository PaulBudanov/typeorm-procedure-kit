import { Brackets } from './Brackets.js';

/**
 * Syntax sugar.
 * Allows to use negate brackets in WHERE expressions for better syntax.
 */
export class NotBrackets extends Brackets {
  public readonly '@instanceof' = Symbol.for('NotBrackets');
}
