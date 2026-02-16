import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when a transaction is required for the current operation, but there is none open.
 */
export class PessimisticLockTransactionRequiredError extends TypeORMError {
  public constructor() {
    super(`An open transaction is required for pessimistic lock.`);
  }
}
