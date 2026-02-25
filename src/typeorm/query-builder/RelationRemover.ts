import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { QueryBuilder } from './QueryBuilder.js';
import type { QueryExpressionMap } from './QueryExpressionMap.js';

/**
 * Allows to work with entity relations and perform specific operations with those relations.
 *
 * todo: add transactions everywhere
 */
export class RelationRemover {
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
   * Performs remove operation on a relation.
   */
  public async remove(value: ObjectLiteral | Array<unknown>): Promise<void> {
    const relation = this.expressionMap.relationMetadata;

    if (relation.isOneToMany) {
      // if (this.expressionMap.of instanceof Array)
      //     throw new TypeORMError(`You cannot update relations of multiple entities with the same related object. Provide a single entity into .of method.`);

      // DELETE FROM post WHERE post.categoryId = of AND post.id = id
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

      const updateSet: ObjectLiteral = {};
      relation.inverseRelation!.joinColumns.forEach((column) => {
        updateSet[column.propertyName] = null;
      });

      const parameters: ObjectLiteral = {};
      const conditions: Array<string> = [];
      ofs.forEach((of, ofIndex) => {
        conditions.push(
          ...values.map((value, valueIndex) => {
            return [
              ...relation.inverseRelation!.joinColumns.map(
                (column, columnIndex) => {
                  const parameterName =
                    'joinColumn_' +
                    ofIndex +
                    '_' +
                    valueIndex +
                    '_' +
                    columnIndex;
                  parameters[parameterName] = ObjectUtils.isObject(of)
                    ? column.referencedColumn!.getEntityValue(
                        of as ObjectLiteral
                      )
                    : of;
                  return `${column.propertyPath} = :${parameterName}`;
                }
              ),
              ...relation.inverseRelation!.entityMetadata.primaryColumns.map(
                (column, columnIndex) => {
                  const parameterName =
                    'primaryColumn_' +
                    valueIndex +
                    '_' +
                    valueIndex +
                    '_' +
                    columnIndex;
                  parameters[parameterName] = ObjectUtils.isObject(value)
                    ? column.getEntityValue(value as ObjectLiteral)
                    : value;
                  return `${column.propertyPath} = :${parameterName}`;
                }
              ),
            ].join(' AND ');
          })
        );
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

      const parameters: ObjectLiteral = {};
      const conditions: Array<string> = [];
      firstColumnValues.forEach((firstColumnVal, firstColumnValIndex) => {
        conditions.push(
          ...secondColumnValues.map((secondColumnVal, secondColumnValIndex) => {
            return [
              ...junctionMetadata.ownerColumns.map((column, columnIndex) => {
                const parameterName =
                  'firstValue_' +
                  firstColumnValIndex +
                  '_' +
                  secondColumnValIndex +
                  '_' +
                  columnIndex;
                parameters[parameterName] = ObjectUtils.isObject(firstColumnVal)
                  ? column.referencedColumn!.getEntityValue(
                      firstColumnVal as ObjectLiteral
                    )
                  : firstColumnVal;
                return `${column.databaseName} = :${parameterName}`;
              }),
              ...junctionMetadata.inverseColumns.map((column, columnIndex) => {
                const parameterName =
                  'secondValue_' +
                  firstColumnValIndex +
                  '_' +
                  secondColumnValIndex +
                  '_' +
                  columnIndex;
                parameters[parameterName] = ObjectUtils.isObject(
                  secondColumnVal
                )
                  ? column.referencedColumn!.getEntityValue(
                      secondColumnVal as ObjectLiteral
                    )
                  : secondColumnVal;
                return `${column.databaseName} = :${parameterName}`;
              }),
            ].join(' AND ');
          })
        );
      });
      const condition = conditions.map((str) => '(' + str + ')').join(' OR ');

      await this.queryBuilder
        .createQueryBuilder<QueryBuilder<ObjectLiteral>>()
        .delete()
        .from(junctionMetadata.tableName)
        .where(condition)
        .setParameters(parameters)
        .execute();
    }
  }
}
