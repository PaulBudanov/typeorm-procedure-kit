import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when an entity does not have no version and no update date column.
 */
export class NoVersionOrUpdateDateColumnError extends TypeORMError {
  public constructor(entity: string) {
    super(`Entity ${entity} does not have version or update date columns.`);
  }
}
