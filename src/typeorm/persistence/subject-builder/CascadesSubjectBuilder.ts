import { ObjectUtils } from '../../util/ObjectUtils.js';
import { Subject } from '../Subject.js';

import type { ObjectLiteral } from '../../common/ObjectLiteral.js';

/**
 * Finds all cascade operations of the given subject and cascade operations of the found cascaded subjects,
 * e.g. builds a cascade tree and creates a subjects for them.
 */
export class CascadesSubjectBuilder {
  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(protected allSubjects: Array<Subject>) {}

  // ---------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------

  /**
   * Builds a cascade subjects tree and pushes them in into the given array of subjects.
   */
  public build(
    subject: Subject,
    operationType: 'save' | 'remove' | 'soft-remove' | 'recover'
  ): void {
    subject.metadata
      .extractRelationValuesFromEntity(
        subject.entity!,
        subject.metadata.relations
      ) // todo: we can create EntityMetadata.cascadeRelations
      .forEach(([relation, relationEntity, relationEntityMetadata]) => {
        // we need only defined values and insert, update, soft-remove or recover cascades of the relation should be set
        if (
          relationEntity === undefined ||
          relationEntity === null ||
          (!relation.isCascadeInsert &&
            !relation.isCascadeUpdate &&
            !relation.isCascadeSoftRemove &&
            !relation.isCascadeRecover)
        )
          return;

        // if relation entity is just a relation id set (for example post.tag = 1)
        // then we don't really need to check cascades since there is no object to insert or update
        if (!ObjectUtils.isObject(relationEntity)) return;

        // if we already has this entity in list of operated subjects then skip it to avoid recursion
        const alreadyExistRelationEntitySubject = this.findByPersistEntityLike(
          relationEntityMetadata.target,
          relationEntity as ObjectLiteral
        );
        if (alreadyExistRelationEntitySubject) {
          if (!alreadyExistRelationEntitySubject.canBeInserted)
            // if its not marked for insertion yet
            alreadyExistRelationEntitySubject.canBeInserted =
              relation.isCascadeInsert && operationType === 'save';
          if (!alreadyExistRelationEntitySubject.canBeUpdated)
            // if its not marked for update yet
            alreadyExistRelationEntitySubject.canBeUpdated =
              relation.isCascadeUpdate && operationType === 'save';
          if (!alreadyExistRelationEntitySubject.canBeSoftRemoved)
            // if its not marked for removal yet
            alreadyExistRelationEntitySubject.canBeSoftRemoved =
              relation.isCascadeSoftRemove && operationType === 'soft-remove';
          if (!alreadyExistRelationEntitySubject.canBeRecovered)
            // if its not marked for recovery yet
            alreadyExistRelationEntitySubject.canBeRecovered =
              relation.isCascadeRecover && operationType === 'recover';
          return;
        }

        // mark subject with what we can do with it
        // and add to the array of subjects to load only if there is no same entity there already
        const relationEntitySubject = new Subject({
          metadata: relationEntityMetadata,
          parentSubject: subject,
          entity: relationEntity as ObjectLiteral,
          canBeInserted: relation.isCascadeInsert && operationType === 'save',
          canBeUpdated: relation.isCascadeUpdate && operationType === 'save',
          canBeSoftRemoved:
            relation.isCascadeSoftRemove && operationType === 'soft-remove',
          canBeRecovered:
            relation.isCascadeRecover && operationType === 'recover',
        });
        this.allSubjects.push(relationEntitySubject);

        // go recursively and find other entities we need to insert/update
        this.build(relationEntitySubject, operationType);
      });
  }

  // ---------------------------------------------------------------------
  // Protected Methods
  // ---------------------------------------------------------------------

  /**
   * Finds subject where entity like given subject's entity.
   * Comparison made by entity id.
   */
  protected findByPersistEntityLike(
    entityTarget: unknown | string,
    entity: ObjectLiteral
  ): Subject | undefined {
    return this.allSubjects.find((subject) => {
      if (!subject.entity) return false;

      if (subject.entity === entity) return true;

      return (
        subject.metadata.target === entityTarget &&
        subject.metadata.compareEntities(
          subject.entityWithFulfilledIds!,
          entity
        )
      );
    });
  }
}
