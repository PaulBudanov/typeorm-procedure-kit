import { TypeORMError } from './TypeORMError.js';

export class NestedSetMultipleRootError extends TypeORMError {
  public constructor() {
    super(`Nested sets do not support multiple root entities.`);
  }
}
