import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { TypeORMError } from '../error/index.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { QueryBuilder } from './QueryBuilder.js';
import type { QueryExpressionMap } from './QueryExpressionMap.js';

/**
 * Allows to work with entity relations and perform specific operations with those relations.
 *
 * todo: add transactions everywhere
 */
export class RelationUpdater {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    protected queryBuilder: QueryBuilder<ObjectLiteral>,
    protected expressionMap: QueryExpressionMap
  ) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Performs set or add operation on a relation.
   */
  public async update(value: unknown | Array<unknown>): Promise<void> {
    const relation = this.expressionMap.relationMetadata;

    if (relation.isManyToOne || relation.isOneToOneOwner) {
      const updateSet = relation.joinColumns.reduce((updateSet, joinColumn) => {
        const relationValue = ObjectUtils.isObject(value)
          ? joinColumn.referencedColumn!.getEntityValue(value as ObjectLiteral)
          : value;
        joinColumn.setEntityValue(updateSet, relationValue);
        return updateSet;
      }, {} as ObjectLiteral);

      if (
        !this.expressionMap.of ||
        (Array.isArray(this.expressionMap.of) && !this.expressionMap.of.length)
      )
        return;

      await this.queryBuilder
        .createQueryBuilder<QueryBuilder<ObjectLiteral>>()
        .update(relation.entityMetadata.target)
        .set(updateSet)
        .whereInIds(this.expressionMap.of as ObjectLiteral)
        .execute();
    } else if (
      (relation.isOneToOneNotOwner || relation.isOneToMany) &&
      value === null
    ) {
      // we handle null a bit different way

      const updateSet: ObjectLiteral = {};
      relation.inverseRelation!.joinColumns.forEach((column) => {
        updateSet[column.propertyName] = null;
      });

      const expressionMapOf = this.expressionMap.of as
        | ObjectLiteral
        | Array<ObjectLiteral>;
      const ofs = (
        Array.isArray(expressionMapOf) ? expressionMapOf : [expressionMapOf]
      ) as Array<ObjectLiteral>;
      const parameters: ObjectLiteral = {};
      const conditions: Array<string> = [];
      ofs.forEach((of, ofIndex) => {
        relation.inverseRelation!.joinColumns.map((column, columnIndex) => {
          const parameterName = 'joinColumn_' + ofIndex + '_' + columnIndex;
          parameters[parameterName] = ObjectUtils.isObject(of)
            ? column.referencedColumn!.getEntityValue(of as ObjectLiteral)
            : of;
          conditions.push(`${column.propertyPath} = :${parameterName}`);
        });
      });
      const condition = conditions.map((str) => '(' + str + ')').join(' OR ');
      if (!condition) return;

      await this.queryBuilder
        .createQueryBuilder<QueryBuilder<ObjectLiteral>>()
        .update(relation.inverseEntityMetadata.target)
        .set(updateSet)
        .where(condition)
        .setParameters(parameters)
        .execute();
    } else if (relation.isOneToOneNotOwner || relation.isOneToMany) {
      if (Array.isArray(this.expressionMap.of))
        throw new TypeORMError(
          `You cannot update relations of multiple entities with the same related object. Provide a single entity into .of method.`
        );

      const of = this.expressionMap.of as ObjectLiteral;
      const updateSet = relation.inverseRelation!.joinColumns.reduce(
        (updateSet, joinColumn) => {
          const relationValue = ObjectUtils.isObject(of)
            ? joinColumn.referencedColumn!.getEntityValue(of)
            : of;
          joinColumn.setEntityValue(updateSet, relationValue);
          return updateSet;
        },
        {} as ObjectLiteral
      );

      if (!value || (Array.isArray(value) && !value.length)) return;

      await this.queryBuilder
        .createQueryBuilder<QueryBuilder<ObjectLiteral>>()
        .update(relation.inverseEntityMetadata.target)
        .set(updateSet)
        .whereInIds(value as ObjectLiteral)
        .execute();
    } else {
      // many to many
      const junctionMetadata = relation.junctionEntityMetadata!;
      const expressionMapOf = this.expressionMap.of as
        | ObjectLiteral
        | Array<ObjectLiteral>;
      const ofs = (
        Array.isArray(expressionMapOf) ? expressionMapOf : [expressionMapOf]
      ) as Array<ObjectLiteral>;
      const valuesArray = value as ObjectLiteral | Array<ObjectLiteral>;
      const values = (
        Array.isArray(valuesArray) ? valuesArray : [valuesArray]
      ) as Array<ObjectLiteral>;
      const firstColumnValues = relation.isManyToManyOwner ? ofs : values;
      const secondColumnValues = relation.isManyToManyOwner ? values : ofs;

      const bulkInserted: Array<ObjectLiteral> = [];
      firstColumnValues.forEach((firstColumnVal) => {
        secondColumnValues.forEach((secondColumnVal) => {
          const inserted: ObjectLiteral = {};
          junctionMetadata.ownerColumns.forEach((column) => {
            inserted[column.databaseName] = ObjectUtils.isObject(firstColumnVal)
              ? column.referencedColumn!.getEntityValue(
                  firstColumnVal as ObjectLiteral
                )
              : firstColumnVal;
          });
          junctionMetadata.inverseColumns.forEach((column) => {
            inserted[column.databaseName] = ObjectUtils.isObject(
              secondColumnVal
            )
              ? column.referencedColumn!.getEntityValue(
                  secondColumnVal as ObjectLiteral
                )
              : secondColumnVal;
          });
          bulkInserted.push(inserted);
        });
      });

      if (!bulkInserted.length) return;

      if (this.queryBuilder.connection.driver.options.type === 'oracle') {
        await Promise.all(
          bulkInserted.map((value) => {
            return this.queryBuilder
              .createQueryBuilder<QueryBuilder<ObjectLiteral>>()
              .insert()
              .into(junctionMetadata.tableName)
              .values(value)
              .execute();
          })
        );
      } else {
        await this.queryBuilder
          .createQueryBuilder<QueryBuilder<ObjectLiteral>>()
          .insert()
          .into(junctionMetadata.tableName)
          .values(bulkInserted)
          .execute();
      }
    }
  }
}
