import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';

import { TypeORMError } from './TypeORMError.js';

export class UsingJoinColumnIsNotAllowedError extends TypeORMError {
  public constructor(
    entityMetadata: EntityMetadata,
    relation: RelationMetadata
  ) {
    super(
      `Using JoinColumn on ${entityMetadata.name}#${relation.propertyName} is wrong. ` +
        `You can use JoinColumn only on one-to-one and many-to-one relations.`
    );
  }
}
