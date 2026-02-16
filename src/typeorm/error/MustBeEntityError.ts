import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when method expects entity but instead something else is given.
 */
export class MustBeEntityError extends TypeORMError {
  public constructor(operation: string, wrongValue: string) {
    super(
      `Cannot ${operation}, given value must be an entity, instead "${wrongValue}" is given.`
    );
  }
}
