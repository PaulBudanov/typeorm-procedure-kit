import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown . Theoretically can't be thrown.
 */
export class PersistedEntityNotFoundError extends TypeORMError {
  public constructor() {
    super(
      `Internal error. Persisted entity was not found in the list of prepared operated entities.`
    );
  }
}
