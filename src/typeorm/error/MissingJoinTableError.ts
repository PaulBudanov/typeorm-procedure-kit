import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';

import { TypeORMError } from './TypeORMError.js';

export class MissingJoinTableError extends TypeORMError {
  public constructor(
    entityMetadata: EntityMetadata,
    relation: RelationMetadata
  ) {
    super();

    if (relation.inverseRelation) {
      this.message =
        `JoinTable is missing on both sides of ${entityMetadata.name}#${relation.propertyName} and ` +
        `${relation.inverseEntityMetadata.name}#${relation.inverseRelation.propertyName} many-to-many relationship. ` +
        `You need to put decorator decorator on one of the sides.`;
    } else {
      this.message =
        `JoinTable is missing on ${entityMetadata.name}#${relation.propertyName} many-to-many relationship. ` +
        `You need to put JoinTable decorator on it.`;
    }
  }
}
