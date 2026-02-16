import { TypeORMError } from './TypeORMError.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';

/**
 * Thrown when specified entity property was not found.
 */
export class EntityPropertyNotFoundError extends TypeORMError {
  public constructor(propertyPath: string, metadata: EntityMetadata) {
    super(propertyPath);
    Object.setPrototypeOf(this, EntityPropertyNotFoundError.prototype);
    this.message = `Property "${propertyPath}" was not found in "${metadata.targetName}". Make sure your query is correct.`;
  }
}
