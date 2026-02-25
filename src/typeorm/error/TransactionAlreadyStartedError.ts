import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when transaction is already started and user tries to run it again.
 */
export class TransactionAlreadyStartedError extends TypeORMError {
  public constructor() {
    super(
      `Transaction already started for the given connection, commit current transaction before starting a new one.`
    );
  }
}
