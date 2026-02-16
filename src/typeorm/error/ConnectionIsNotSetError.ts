import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when user tries to execute operation that requires connection to be established.
 */
export class ConnectionIsNotSetError extends TypeORMError {
  public constructor(dbType: string) {
    super(
      `Connection with ${dbType} database is not established. Check connection configuration.`
    );
  }
}
