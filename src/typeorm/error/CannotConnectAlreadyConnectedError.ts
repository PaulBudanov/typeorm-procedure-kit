import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when consumer tries to connect when he already connected.
 */
export class CannotConnectAlreadyConnectedError extends TypeORMError {
  public constructor(connectionName: string) {
    super(
      `Cannot create a "${connectionName}" connection because connection to the database already established.`
    );
  }
}
