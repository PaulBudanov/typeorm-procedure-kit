import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when consumer tries to get connection that does not exist.
 */
export class ConnectionNotFoundError extends TypeORMError {
  public constructor(name: string) {
    super(`Connection "${name}" was not found.`);
  }
}
