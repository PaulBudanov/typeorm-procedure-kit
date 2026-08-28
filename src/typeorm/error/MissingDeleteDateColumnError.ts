import { TypeORMError } from './TypeORMError.js';

import type { EntityMetadata } from '../metadata/EntityMetadata.js';

export class MissingDeleteDateColumnError extends TypeORMError {
  public constructor(entityMetadata: EntityMetadata) {
    super(`Entity "${entityMetadata.name}" does not have delete date columns.`);
  }
}
