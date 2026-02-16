import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';
import { TypeORMError } from './TypeORMError.js';

export class UsingJoinTableIsNotAllowedError extends TypeORMError {
  public constructor(
    entityMetadata: EntityMetadata,
    relation: RelationMetadata
  ) {
    super(
      `Using JoinTable on ${entityMetadata.name}#${relation.propertyName} is wrong. ` +
        `${entityMetadata.name}#${relation.propertyName} has ${relation.relationType} relation, ` +
        `however you can use JoinTable only on many-to-many relations.`
    );
  }
}
