import { formatDatabaseIdentifier } from '../../data-source/IdentifierQuoting.js';
import { OrmUtils } from '../../util/OrmUtils.js';

import type { RelationCountAttribute } from './RelationCountAttribute.js';
import type { RelationCountLoadResult } from './RelationCountLoadResult.js';
import type { DataSource } from '../../data-source/DataSource.js';
import type { TIdentifierQuoting } from '../../data-source/DataSourceOptions.js';
import type { ColumnMetadata } from '../../metadata/ColumnMetadata.js';
import type { QueryRunner } from '../../query-runner/QueryRunner.js';

export class RelationCountLoader {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    protected connection: DataSource,
    protected queryRunner: QueryRunner | undefined,
    protected relationCountAttributes: Array<RelationCountAttribute>,
    protected readonly identifierQuoting: TIdentifierQuoting = connection.identifierQuoting
  ) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public async load(
    rawEntities: Array<unknown>
  ): Promise<Array<RelationCountLoadResult>> {
    const onlyUnique = (
      value: unknown,
      index: number,
      self: Array<unknown>
    ): boolean => {
      return self.indexOf(value) === index;
    };

    const tasks = this.relationCountAttributes.map(
      (relationCountAttr, attributeIndex) =>
        async (): Promise<RelationCountLoadResult> => {
          if (relationCountAttr.relation.isOneToMany) {
            // example: Post and Category
            // loadRelationCountAndMap("post.categoryCount", "post.categories")
            // we expect it to load array of post ids

            // todo(dima): fix issues wit multiple primary keys and remove joinColumns[0]
            const relation = relationCountAttr.relation; // "category.posts"
            const inverseRelation = relation.inverseRelation!; // "post.category"
            const referenceColumnName =
              inverseRelation.joinColumns[0]!.referencedColumn!.propertyName; // post id
            const inverseSideTable = relation.inverseEntityMetadata.target; // Post
            const inverseSideTableName =
              relation.inverseEntityMetadata.tableName; // post
            const inverseSideTableAlias =
              relationCountAttr.alias || inverseSideTableName; // if condition (custom query builder factory) is set then relationIdAttr.alias defined
            const inverseSidePropertyName = inverseRelation.propertyName; // "category" from "post.category"

            let referenceColumnValues = rawEntities
              .map(
                (rawEntity) =>
                  (rawEntity as Record<string, unknown>)[
                    relationCountAttr.parentAlias + '_' + referenceColumnName
                  ]
              )
              .filter((value) => value !== null && value !== undefined);
            referenceColumnValues = referenceColumnValues.filter(onlyUnique);

            // ensure we won't perform redundant queries for joined data which was not found in selection
            // example: if post.category was not found in db then no need to execute query for category.imageIds
            if (referenceColumnValues.length === 0)
              return {
                relationCountAttribute: relationCountAttr,
                results: [],
              };

            // generate query:
            // SELECT category.post as parentId, COUNT(*) AS cnt FROM category category WHERE category.post IN (1, 2) GROUP BY category.post
            const qb = this.connection
              .createQueryBuilder(this.queryRunner)
              .setIdentifierQuoting(this.identifierQuoting);
            qb.select(
              inverseSideTableAlias + '.' + inverseSidePropertyName,
              'parentId'
            )
              .addSelect('COUNT(*)', 'cnt')
              .from(inverseSideTable, inverseSideTableAlias)
              .where(
                inverseSideTableAlias +
                  '.' +
                  inverseSidePropertyName +
                  ' IN (:...ids)'
              )
              .addGroupBy(inverseSideTableAlias + '.' + inverseSidePropertyName)
              .setParameter('ids', referenceColumnValues);

            // apply condition (custom query builder factory)
            if (relationCountAttr.queryBuilderFactory)
              relationCountAttr.queryBuilderFactory(qb);

            return {
              relationCountAttribute: relationCountAttr,
              results: await qb.getRawMany(),
            };
          } else {
            // example: Post and Category
            // owner side: loadRelationIdAndMap("post.categoryIds", "post.categories")
            // inverse side: loadRelationIdAndMap("category.postIds", "category.posts")
            // we expect it to load array of post ids

            let joinTableColumnName: string;
            let inverseJoinColumnName: string;
            let firstJunctionColumn!: ColumnMetadata;
            let secondJunctionColumn!: ColumnMetadata;

            if (relationCountAttr.relation.isOwning) {
              // todo fix joinColumns[0] and inverseJoinColumns[0].
              joinTableColumnName =
                relationCountAttr.relation.joinColumns[0]!.referencedColumn!
                  .databaseName;
              inverseJoinColumnName =
                relationCountAttr.relation.inverseJoinColumns[0]!
                  .referencedColumn!.databaseName;
              firstJunctionColumn =
                relationCountAttr.relation.junctionEntityMetadata!.columns[0]!;
              secondJunctionColumn =
                relationCountAttr.relation.junctionEntityMetadata!.columns[1]!;
            } else {
              joinTableColumnName =
                relationCountAttr.relation.inverseRelation!
                  .inverseJoinColumns[0]!.referencedColumn!.databaseName;
              inverseJoinColumnName =
                relationCountAttr.relation.inverseRelation!.joinColumns[0]!
                  .referencedColumn!.databaseName;
              firstJunctionColumn =
                relationCountAttr.relation.junctionEntityMetadata!.columns[1]!;
              secondJunctionColumn =
                relationCountAttr.relation.junctionEntityMetadata!.columns[0]!;
            }

            let referenceColumnValues = rawEntities
              .map(
                (rawEntity) =>
                  (rawEntity as Record<string, unknown>)[
                    relationCountAttr.parentAlias + '_' + joinTableColumnName
                  ]
              )
              .filter((value) => value !== null && value !== undefined);
            referenceColumnValues = referenceColumnValues.filter(onlyUnique);

            // ensure we won't perform redundant queries for joined data which was not found in selection
            // example: if post.category was not found in db then no need to execute query for category.imageIds
            if (referenceColumnValues.length === 0)
              return {
                relationCountAttribute: relationCountAttr,
                results: [],
              };

            const junctionAlias = relationCountAttr.junctionAlias;
            const inverseSideTableName =
              relationCountAttr.joinInverseSideMetadata.tableName;
            const inverseSideTableAlias =
              relationCountAttr.alias || inverseSideTableName;
            const junctionTableName =
              relationCountAttr.relation.junctionEntityMetadata!.tableName;

            const referenceValuesParameter = `orm_relation_count_${attributeIndex}_values`;
            const condition =
              this.escapeAliasColumn(
                junctionAlias,
                firstJunctionColumn.databaseName
              ) +
              ` IN (:...${referenceValuesParameter})` +
              ' AND ' +
              this.escapeAliasColumn(
                junctionAlias,
                secondJunctionColumn.databaseName
              ) +
              ' = ' +
              this.escapeAliasColumn(
                inverseSideTableAlias,
                inverseJoinColumnName
              );

            const qb = this.connection
              .createQueryBuilder(this.queryRunner)
              .setIdentifierQuoting(this.identifierQuoting);
            qb.select(
              this.escapeAliasColumn(
                junctionAlias,
                firstJunctionColumn.databaseName
              ),
              'parentId'
            )
              .addSelect(
                'COUNT(' +
                  qb.escape(inverseSideTableAlias) +
                  '.' +
                  formatDatabaseIdentifier(
                    inverseJoinColumnName,
                    this.identifierQuoting,
                    this.connection.options.type,
                    (identifier) => this.connection.driver.escape(identifier)
                  ) +
                  ')',
                'cnt'
              )
              .from(inverseSideTableName, inverseSideTableAlias)
              .innerJoin(junctionTableName, junctionAlias, condition)
              .addGroupBy(
                this.escapeAliasColumn(
                  junctionAlias,
                  firstJunctionColumn.databaseName
                )
              )
              .setParameter(referenceValuesParameter, referenceColumnValues);

            // apply condition (custom query builder factory)
            if (relationCountAttr.queryBuilderFactory)
              relationCountAttr.queryBuilderFactory(qb);

            return {
              relationCountAttribute: relationCountAttr,
              results: await qb.getRawMany(),
            };
          }
        }
    );

    return OrmUtils.executeTasks(
      tasks,
      this.connection.options.type === 'postgres' && !!this.queryRunner
    );
  }

  private escapeAliasColumn(alias: string, columnName: string): string {
    const { driver } = this.connection;

    return `${driver.escape(alias)}.${formatDatabaseIdentifier(
      columnName,
      this.identifierQuoting,
      this.connection.options.type,
      (identifier) => driver.escape(identifier)
    )}`;
  }
}
