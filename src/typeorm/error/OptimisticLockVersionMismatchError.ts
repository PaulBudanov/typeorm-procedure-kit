import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when a version check on an object that uses optimistic locking through a version field fails.
 */
export class OptimisticLockVersionMismatchError extends TypeORMError {
  public constructor(
    entity: string,
    expectedVersion: number | Date,
    actualVersion: number | Date
  ) {
    super(
      `The optimistic lock on entity ${entity} failed, version ${expectedVersion} was expected, but is actually ${actualVersion}.`
    );
  }
}
