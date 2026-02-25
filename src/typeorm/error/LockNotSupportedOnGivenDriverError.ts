import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when selected sql driver does not supports locking.
 */
export class LockNotSupportedOnGivenDriverError extends TypeORMError {
  public constructor() {
    super(`Locking not supported on given driver.`);
  }
}
