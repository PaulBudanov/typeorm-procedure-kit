import { TypeORMError } from './TypeORMError.js';

export class PrimaryColumnCannotBeNullableError extends TypeORMError {
  public constructor(object: object, propertyName: string) {
    super(
      `Primary column ${
        object.constructor.name
      }#${propertyName} cannot be nullable. ` +
        `Its not allowed for primary keys. Try to remove nullable option.`
    );
  }
}
