import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import type { DataSource } from '../../data-source/DataSource.js';
import { DriverUtils } from '../../driver/DriverUtils.js';
import { TypeORMError } from '../../error/TypeORMError.js';
import type { QueryRunner } from '../../query-runner/QueryRunner.js';
import { OrmUtils } from '../../util/OrmUtils.js';

import type { RelationIdAttribute } from './RelationIdAttribute.js';
import type { RelationIdLoadResult } from './RelationIdLoadResult.js';

export class RelationIdLoader {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    protected connection: DataSource,
    protected queryRunner: QueryRunner | undefined,
    protected relationIdAttributes: Array<RelationIdAttribute>
  ) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public async load(
    rawEntities: Array<unknown>
  ): Promise<Array<RelationIdLoadResult>> {
    const promises = this.relationIdAttributes.map(
      async (relationIdAttr): Promise<RelationIdLoadResult> => {
        if (
          relationIdAttr.relation.isManyToOne ||
          relationIdAttr.relation.isOneToOneOwner
        ) {
          // example: Post and Tag
          // loadRelationIdAndMap("post.tagId", "post.tag")
          // we expect it to load id of tag

          if (relationIdAttr.queryBuilderFactory)
            throw new TypeORMError(
              'Additional condition can not be used with ManyToOne or OneToOne owner relations.'
            );

          const duplicates: Record<string, boolean> = {};
          const results = rawEntities
            .map((rawEntity): Record<string, unknown> | null => {
              const entityRecord = rawEntity as Record<string, unknown>;
              const result: ObjectLiteral = {};
              const duplicateParts: Array<string> = [];
              relationIdAttr.relation.joinColumns.forEach((joinColumn) => {
                const alias = DriverUtils.buildAlias(
                  this.connection.driver,
                  undefined,
                  relationIdAttr.parentAlias,
                  joinColumn.databaseName
                );
                const rawValue = entityRecord[alias];
                result[joinColumn.databaseName] = this.prepareHydratedValue(
                  rawValue,
                  joinColumn.referencedColumn
                );
                const duplicatePart = `${
                  joinColumn.databaseName
                }:${result[joinColumn.databaseName]}`;
                if (duplicateParts.indexOf(duplicatePart) === -1) {
                  duplicateParts.push(duplicatePart);
                }
              });

              relationIdAttr.relation.entityMetadata.primaryColumns.forEach(
                (primaryColumn) => {
                  const alias = DriverUtils.buildAlias(
                    this.connection.driver,
                    undefined,
                    relationIdAttr.parentAlias,
                    primaryColumn.databaseName
                  );
                  const rawValue = entityRecord[alias];
                  result[primaryColumn.databaseName] =
                    this.prepareHydratedValue(rawValue, primaryColumn);
                  const duplicatePart = `${
                    primaryColumn.databaseName
                  }:${result[primaryColumn.databaseName]}`;
                  if (duplicateParts.indexOf(duplicatePart) === -1) {
                    duplicateParts.push(duplicatePart);
                  }
                }
              );

              duplicateParts.sort();
              const duplicate = duplicateParts.join('::');
              if (duplicates[duplicate]) {
                return null;
              }
              duplicates[duplicate] = true;
              return result;
            })
            .filter((v): v is Record<string, unknown> => v !== null);

          return {
            relationIdAttribute: relationIdAttr,
            results: results,
          };
        } else if (
          relationIdAttr.relation.isOneToMany ||
          relationIdAttr.relation.isOneToOneNotOwner
        ) {
          // example: Post and Category
          // loadRelationIdAndMap("post.categoryIds", "post.categories")
          // we expect it to load array of category ids

          const relation = relationIdAttr.relation; // "post.categories"
          const joinColumns = relation.isOwning
            ? relation.joinColumns
            : relation.inverseRelation!.joinColumns;
          const table = relation.inverseEntityMetadata.target; // category
          const tableName = relation.inverseEntityMetadata.tableName; // category
          const tableAlias = relationIdAttr.alias || tableName; // if condition (custom query builder factory) is set then relationIdAttr.alias defined

          const duplicates: Record<string, boolean> = {};
          const parameters: ObjectLiteral = {};
          const condition = rawEntities
            .map((rawEntity, index): string => {
              const entityRecord = rawEntity as Record<string, unknown>;
              const duplicateParts: Array<string> = [];
              const parameterParts: ObjectLiteral = {};
              const queryPart = joinColumns
                .map((joinColumn): string => {
                  const parameterName = joinColumn.databaseName + index;
                  const referencedColumn = joinColumn.referencedColumn;
                  if (!referencedColumn) {
                    return '';
                  }
                  const alias = DriverUtils.buildAlias(
                    this.connection.driver,
                    undefined,
                    relationIdAttr.parentAlias,
                    referencedColumn.databaseName
                  );
                  const parameterValue = entityRecord[alias];
                  const duplicatePart = `${tableAlias}:${joinColumn.propertyPath}:${parameterValue}`;
                  if (duplicateParts.indexOf(duplicatePart) !== -1) {
                    return '';
                  }
                  duplicateParts.push(duplicatePart);
                  parameterParts[parameterName] = parameterValue;
                  return (
                    tableAlias +
                    '.' +
                    joinColumn.propertyPath +
                    ' = :' +
                    parameterName
                  );
                })
                .filter((v): v is string => v !== '')
                .join(' AND ');
              duplicateParts.sort();
              const duplicate = duplicateParts.join('::');
              if (duplicates[duplicate]) {
                return '';
              }
              duplicates[duplicate] = true;
              Object.assign(parameters, parameterParts);
              return queryPart;
            })
            .filter((v): v is string => v !== '')
            .map((condition): string => '(' + condition + ')')
            .join(' OR ');

          // ensure we won't perform redundant queries for joined data which was not found in selection
          // example: if post.category was not found in db then no need to execute query for category.imageIds
          if (!condition)
            return {
              relationIdAttribute: relationIdAttr,
              results: [],
            };

          // generate query:
          // SELECT category.id, category.postId FROM category category ON category.postId = :postId
          const qb = this.connection.createQueryBuilder(this.queryRunner);

          const columns = OrmUtils.uniq(
            [
              ...joinColumns,
              ...relation.inverseRelation!.entityMetadata.primaryColumns,
            ],
            (column) => column.propertyPath
          );

          columns.forEach((joinColumn) => {
            qb.addSelect(
              tableAlias + '.' + joinColumn.propertyPath,
              joinColumn.databaseName
            );
          });

          qb.from(table, tableAlias)
            .where('(' + condition + ')') // need brackets because if we have additional condition and no brackets, it looks like (a = 1) OR (a = 2) AND b = 1, that is incorrect
            .setParameters(parameters);

          // apply condition (custom query builder factory)
          if (relationIdAttr.queryBuilderFactory)
            relationIdAttr.queryBuilderFactory(qb);

          const results = (await qb.getRawMany()) as Array<ObjectLiteral>;
          results.forEach((result) => {
            joinColumns.forEach((column) => {
              result[column.databaseName] = this.prepareHydratedValue(
                result[column.databaseName],
                column.referencedColumn
              );
            });
            relation.inverseRelation!.entityMetadata.primaryColumns.forEach(
              (column) => {
                result[column.databaseName] = this.prepareHydratedValue(
                  result[column.databaseName],
                  column
                );
              }
            );
          });

          return {
            relationIdAttribute: relationIdAttr,
            results,
          };
        } else {
          // many-to-many
          // example: Post and Category
          // owner side: loadRelationIdAndMap("post.categoryIds", "post.categories")
          // inverse side: loadRelationIdAndMap("category.postIds", "category.posts")
          // we expect it to load array of post ids

          const relation = relationIdAttr.relation;
          const joinColumns = relation.isOwning
            ? relation.joinColumns
            : relation.inverseRelation!.inverseJoinColumns;
          const inverseJoinColumns = relation.isOwning
            ? relation.inverseJoinColumns
            : relation.inverseRelation!.joinColumns;
          const junctionAlias = relationIdAttr.junctionAlias;
          const inverseSideTableName =
            relationIdAttr.joinInverseSideMetadata.tableName;
          const inverseSideTableAlias =
            relationIdAttr.alias || inverseSideTableName;
          const junctionTableName = relation.isOwning
            ? relation.junctionEntityMetadata!.tableName
            : relation.inverseRelation!.junctionEntityMetadata!.tableName;

          const mappedColumns = rawEntities.map((rawEntity) => {
            const entityRecord = rawEntity as Record<string, unknown>;
            return joinColumns.reduce((map, joinColumn) => {
              const referencedColumn = joinColumn.referencedColumn;
              if (!referencedColumn) {
                return map;
              }
              const alias = DriverUtils.buildAlias(
                this.connection.driver,
                undefined,
                relationIdAttr.parentAlias,
                referencedColumn.databaseName
              );
              map[joinColumn.propertyPath] = entityRecord[alias];
              return map;
            }, {} as ObjectLiteral);
          });

          // ensure we won't perform redundant queries for joined data which was not found in selection
          // example: if post.category was not found in db then no need to execute query for category.imageIds
          if (mappedColumns.length === 0)
            return {
              relationIdAttribute: relationIdAttr,
              results: [],
            };

          const parameters: ObjectLiteral = {};
          const duplicates: Record<string, boolean> = {};
          const joinColumnConditions = mappedColumns
            .map((mappedColumn, index): string => {
              const duplicateParts: Array<string> = [];
              const parameterParts: ObjectLiteral = {};
              const queryPart = Object.keys(mappedColumn)
                .map((key): string => {
                  const parameterName = key + index;
                  const parameterValue = mappedColumn[key];
                  const duplicatePart = `${junctionAlias}:${key}:${parameterValue}`;
                  if (duplicateParts.indexOf(duplicatePart) !== -1) {
                    return '';
                  }
                  duplicateParts.push(duplicatePart);
                  parameterParts[parameterName] = parameterValue;
                  return junctionAlias + '.' + key + ' = :' + parameterName;
                })
                .filter((s): s is string => s !== '')
                .join(' AND ');
              duplicateParts.sort();
              const duplicate = duplicateParts.join('::');
              if (duplicates[duplicate]) {
                return '';
              }
              duplicates[duplicate] = true;
              Object.assign(parameters, parameterParts);
              return queryPart;
            })
            .filter((s): s is string => s !== '');

          const inverseJoinColumnCondition = inverseJoinColumns
            .map((joinColumn): string => {
              const referencedColumn = joinColumn.referencedColumn;
              if (!referencedColumn) {
                return '';
              }
              return (
                junctionAlias +
                '.' +
                joinColumn.propertyPath +
                ' = ' +
                inverseSideTableAlias +
                '.' +
                referencedColumn.propertyPath
              );
            })
            .filter((s): s is string => s !== '')
            .join(' AND ');

          const condition = joinColumnConditions
            .map((condition): string => {
              return (
                '(' + condition + ' AND ' + inverseJoinColumnCondition + ')'
              );
            })
            .join(' OR ');

          const qb = this.connection.createQueryBuilder(this.queryRunner);

          inverseJoinColumns.forEach((joinColumn) => {
            qb.addSelect(
              junctionAlias + '.' + joinColumn.propertyPath,
              joinColumn.databaseName
            ).addOrderBy(junctionAlias + '.' + joinColumn.propertyPath);
          });

          joinColumns.forEach((joinColumn) => {
            qb.addSelect(
              junctionAlias + '.' + joinColumn.propertyPath,
              joinColumn.databaseName
            ).addOrderBy(junctionAlias + '.' + joinColumn.propertyPath);
          });

          qb.from(inverseSideTableName, inverseSideTableAlias)
            .innerJoin(junctionTableName, junctionAlias, condition)
            .setParameters(parameters);

          // apply condition (custom query builder factory)
          if (relationIdAttr.queryBuilderFactory)
            relationIdAttr.queryBuilderFactory(qb);

          const results = (await qb.getRawMany()) as Array<ObjectLiteral>;
          results.forEach((result) => {
            [...joinColumns, ...inverseJoinColumns].forEach((column) => {
              result[column.databaseName] = this.prepareHydratedValue(
                result[column.databaseName],
                column.referencedColumn
              );
            });
          });

          return {
            relationIdAttribute: relationIdAttr,
            results,
          };
        }
      }
    );

    return Promise.all(promises);
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Prepares hydrated value for the given column.
   */
  protected prepareHydratedValue(
    value: unknown,
    columnMetadata:
      | import('../../metadata/ColumnMetadata.js').ColumnMetadata
      | undefined
  ): unknown {
    if (!columnMetadata) {
      return value;
    }
    return this.connection.driver.prepareHydratedValue(value, columnMetadata);
  }
}
