import { TypeORMError } from '../error/TypeORMError.js';

export class EntitySchemaEmbeddedError extends TypeORMError {
  public static createEntitySchemaIsRequiredException(
    field: string
  ): EntitySchemaEmbeddedError {
    return new EntitySchemaEmbeddedError(
      `EntitySchema is required for ${field} embedded field`
    );
  }

  public static createTargetIsRequired(
    field: string
  ): EntitySchemaEmbeddedError {
    return new EntitySchemaEmbeddedError(
      `Target field is required for ${field} embedded EntitySchema`
    );
  }

  public constructor(message: string) {
    super(message);
  }
}
