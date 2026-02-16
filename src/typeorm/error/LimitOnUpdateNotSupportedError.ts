import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when user tries to build an UPDATE query with LIMIT but the database does not support it.
 */

export class LimitOnUpdateNotSupportedError extends TypeORMError {
  public constructor() {
    super(`Your database does not support LIMIT on UPDATE statements.`);
  }
}
