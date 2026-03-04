import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import type { ColumnMetadata } from '../../metadata/ColumnMetadata.js';
import { EntityMetadata } from '../../metadata/EntityMetadata.js';
import { Brackets } from '../../query-builder/Brackets.js';
import type { QueryRunner } from '../../query-runner/QueryRunner.js';
import { OrmUtils } from '../../util/OrmUtils.js';
import { Subject } from '../Subject.js';

/**
 * Executes subject operations for materialized-path tree entities.
 */
export class MaterializedPathSubjectExecutor {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(protected queryRunner: QueryRunner) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Executes operations when subject is being inserted.
   */
  public async insert(subject: Subject): Promise<void> {
    let parent = subject.metadata.treeParentRelation!.getEntityValue(
      subject.entity!
    ); // if entity was attached via parent
    if (!parent && subject.parentSubject && subject.parentSubject.entity)
      // if entity was attached via children
      parent = subject.parentSubject.insertedValueSet
        ? subject.parentSubject.insertedValueSet
        : subject.parentSubject.entity;

    const parentId = subject.metadata.getEntityIdMap(parent);

    let parentPath = '';
    if (parentId) {
      parentPath = await this.getEntityPath(subject, parentId);
    }

    const insertedEntityId = subject.metadata
      .treeParentRelation!.joinColumns.map((joinColumn) => {
        return joinColumn.referencedColumn!.getEntityValue(
          subject.insertedValueSet!
        );
      })
      .join('_');

    await this.queryRunner.manager
      .createQueryBuilder()
      .update(subject.metadata.target)
      .set({
        [subject.metadata.materializedPathColumn!.propertyPath]:
          parentPath + insertedEntityId + '.',
      })
      .where(subject.identifier!)
      .execute();
  }

  /**
   * Executes operations when subject is being updated.
   */
  public async update(subject: Subject): Promise<void> {
    let newParent = subject.metadata.treeParentRelation!.getEntityValue(
      subject.entity!
    ); // if entity was attached via parent
    if (!newParent && subject.parentSubject && subject.parentSubject.entity)
      // if entity was attached via children
      newParent = subject.parentSubject.entity;

    let entity = subject.databaseEntity; // if entity was attached via parent
    if (!entity && newParent) {
      // if entity was attached via children
      const childrenValue =
        subject.metadata.treeChildrenRelation!.getEntityValue(newParent);
      entity = (childrenValue as unknown as Array<ObjectLiteral>).find(
        (child) => {
          return Object.entries(subject.identifier!).every(
            ([key, value]) =>
              child[key as keyof typeof subject.identifier] ===
              (value as unknown)
          );
        }
      );
    }

    const oldParent = subject.metadata.treeParentRelation!.getEntityValue(
      entity!
    );
    const oldParentId = this.getEntityParentReferencedColumnMap(
      subject,
      oldParent
    );
    const newParentId = this.getEntityParentReferencedColumnMap(
      subject,
      newParent
    );

    // Exit if the new and old parents are the same
    if (OrmUtils.compareIds(oldParentId, newParentId)) {
      return;
    }

    let newParentPath = '';
    if (newParentId) {
      newParentPath = await this.getEntityPath(subject, newParentId);
    }

    let oldParentPath = '';
    if (oldParentId) {
      oldParentPath = (await this.getEntityPath(subject, oldParentId)) || '';
    }

    const entityPath = subject.metadata
      .treeParentRelation!.joinColumns.map((joinColumn) => {
        return joinColumn.referencedColumn!.getEntityValue(entity!);
      })
      .join('_');

    const propertyPath = subject.metadata.materializedPathColumn!.propertyPath;
    await this.queryRunner.manager
      .createQueryBuilder()
      .update(subject.metadata.target)
      .set({
        [propertyPath]: () =>
          `REPLACE(${
            (this.queryRunner.connection.driver.escape(propertyPath), true)
          }, '${oldParentPath}${entityPath}.', '${newParentPath}${entityPath}.')`,
      })
      .where(`${propertyPath} LIKE :path`, {
        path: `${oldParentPath}${entityPath}.%`,
      })
      .execute();
  }

  private getEntityParentReferencedColumnMap(
    subject: Subject,
    entity: ObjectLiteral | undefined
  ): ObjectLiteral | undefined {
    if (!entity) return undefined;
    const columns = subject.metadata
      .treeParentRelation!.joinColumns.map((column) => column.referencedColumn)
      .filter((v) => v != null) as Array<ColumnMetadata>;
    return EntityMetadata.getValueMap(entity, columns);
  }

  private getEntityPath(subject: Subject, id: ObjectLiteral): Promise<string> {
    const metadata = subject.metadata;
    const normalized = (Array.isArray(id) ? id : [id]).map((id) =>
      metadata.ensureEntityIdMap(id)
    );
    return this.queryRunner.manager
      .createQueryBuilder()
      .select(
        subject.metadata.targetName +
          '.' +
          subject.metadata.materializedPathColumn!.propertyPath,
        'path'
      )
      .from(subject.metadata.target, subject.metadata.targetName)
      .where(
        new Brackets((qb) => {
          for (const data of normalized) {
            qb.orWhere(new Brackets((qb) => qb.where(data)));
          }
        })
      )
      .getRawOne()
      .then((result) =>
        result ? ((result as Record<string, string>)['path'] as string) : ''
      );
  }
}
