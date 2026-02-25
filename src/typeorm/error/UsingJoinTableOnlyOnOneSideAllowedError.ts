import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';

import { TypeORMError } from './TypeORMError.js';

export class UsingJoinTableOnlyOnOneSideAllowedError extends TypeORMError {
  public constructor(
    entityMetadata: EntityMetadata,
    relation: RelationMetadata
  ) {
    super(
      `Using JoinTable is allowed only on one side of the many-to-many relationship. ` +
        `Both ${entityMetadata.name}#${relation.propertyName} and ${
          relation.inverseEntityMetadata.name
        }#${relation.inverseRelation!.propertyName} ` +
        `has JoinTable decorators. Choose one of them and left JoinColumn decorator only on it.`
    );
  }
}
