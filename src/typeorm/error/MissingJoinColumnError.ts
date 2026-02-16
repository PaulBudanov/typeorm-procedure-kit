import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';
import { TypeORMError } from './TypeORMError.js';

export class MissingJoinColumnError extends TypeORMError {
  public constructor(
    entityMetadata: EntityMetadata,
    relation: RelationMetadata
  ) {
    super();

    if (relation.inverseRelation) {
      this.message =
        `JoinColumn is missing on both sides of ${entityMetadata.name}#${relation.propertyName} and ` +
        `${relation.inverseEntityMetadata.name}#${relation.inverseRelation.propertyName} one-to-one relationship. ` +
        `You need to put JoinColumn decorator on one of the sides.`;
    } else {
      this.message =
        `JoinColumn is missing on ${entityMetadata.name}#${relation.propertyName} one-to-one relationship. ` +
        `You need to put JoinColumn decorator on it.`;
    }
  }
}
