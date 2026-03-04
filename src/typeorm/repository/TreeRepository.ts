import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { TypeORMError } from '../error/TypeORMError.js';
import { FindOptionsUtils } from '../find-options/FindOptionsUtils.js';
import type { FindTreeOptions } from '../find-options/FindTreeOptions.js';
import { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';
import { TreeRepositoryUtils } from '../util/TreeRepositoryUtils.js';

import { Repository } from './Repository.js';

/**
 * Repository with additional functions to work with trees.
 *
 * @see Repository
 */
export class TreeRepository<
  Entity extends ObjectLiteral,
> extends Repository<Entity> {
  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Gets complete trees for all roots in the table.
   */
  public async findTrees(options?: FindTreeOptions): Promise<Array<Entity>> {
    const roots = await this.findRoots(options);
    await Promise.all(
      roots.map((root) => this.findDescendantsTree(root, options))
    );
    return roots;
  }

  /**
   * Roots are entities that have no ancestors. Finds them all.
   */
  public findRoots(options?: FindTreeOptions): Promise<Array<Entity>> {
    const escapeAlias = (alias: string): string =>
      this.manager.connection.driver.escape(alias, true);
    const escapeColumn = (column: string): string =>
      this.manager.connection.driver.escape(column);

    const joinColumn = this.metadata.treeParentRelation!.joinColumns[0]!;
    const parentPropertyName =
      joinColumn.givenDatabaseName || joinColumn.databaseName;

    const qb = this.createQueryBuilder('treeEntity');
    FindOptionsUtils.applyOptionsToTreeQueryBuilder(qb, options);

    return qb
      .where(
        `${escapeAlias('treeEntity')}.${escapeColumn(
          parentPropertyName
        )} IS NULL`
      )
      .getMany() as Promise<Array<Entity>>;
  }

  /**
   * Gets all children (descendants) of the given entity. Returns them all in a flat array.
   */
  public findDescendants(
    entity: Entity,
    options?: FindTreeOptions
  ): Promise<Array<Entity>> {
    const qb = this.createDescendantsQueryBuilder(
      'treeEntity',
      'treeClosure',
      entity
    );
    FindOptionsUtils.applyOptionsToTreeQueryBuilder(qb, options);
    return qb.getMany();
  }

  /**
   * Gets all children (descendants) of the given entity. Returns them in a tree - nested into each other.
   */
  public async findDescendantsTree(
    entity: Entity,
    options?: FindTreeOptions
  ): Promise<Entity> {
    // todo: throw exception if there is no column of this relation?

    const qb: SelectQueryBuilder<Entity> = this.createDescendantsQueryBuilder(
      'treeEntity',
      'treeClosure',
      entity
    );
    FindOptionsUtils.applyOptionsToTreeQueryBuilder(qb, options);

    const entities = await qb.getRawAndEntities();
    const relationMaps = TreeRepositoryUtils.createRelationMaps(
      this.manager,
      this.metadata,
      'treeEntity',
      entities.raw as Array<Record<string, unknown>>
    );
    TreeRepositoryUtils.buildChildrenEntityTree(
      this.metadata,
      entity,
      entities.entities,
      relationMaps,
      {
        depth: -1,
        ...options,
      }
    );

    return entity;
  }

  /**
   * Gets number of descendants of the entity.
   */
  public countDescendants(entity: Entity): Promise<number> {
    return this.createDescendantsQueryBuilder(
      'treeEntity',
      'treeClosure',
      entity
    ).getCount();
  }

  /**
   * Creates a query builder used to get descendants of the entities in a tree.
   */
  public createDescendantsQueryBuilder(
    alias: string,
    closureTableAlias: string,
    entity: Entity
  ): SelectQueryBuilder<Entity> {
    // create shortcuts for better readability
    const escape = (alias: string, isNeedQuote = false): string =>
      this.manager.connection.driver.escape(alias, isNeedQuote);

    if (this.metadata.treeType === 'closure-table') {
      const joinCondition = this.metadata.closureJunctionTable.descendantColumns
        .map((column) => {
          return (
            escape(closureTableAlias, true) +
            '.' +
            escape(column.propertyPath) +
            ' = ' +
            escape(alias, true) +
            '.' +
            escape(column.referencedColumn!.propertyPath)
          );
        })
        .join(' AND ');

      const parameters: ObjectLiteral = {};
      const whereCondition = this.metadata.closureJunctionTable.ancestorColumns
        .map((column) => {
          parameters[column.referencedColumn!.propertyName] =
            column.referencedColumn!.getEntityValue(entity);
          return (
            escape(closureTableAlias, true) +
            '.' +
            escape(column.propertyPath) +
            ' = :' +
            column.referencedColumn!.propertyName
          );
        })
        .join(' AND ');

      return this.createQueryBuilder(alias)
        .innerJoin(
          this.metadata.closureJunctionTable.tableName,
          closureTableAlias,
          joinCondition
        )
        .where(whereCondition)
        .setParameters(parameters) as SelectQueryBuilder<Entity>;
    } else if (this.metadata.treeType === 'nested-set') {
      const whereCondition =
        alias +
        '.' +
        this.metadata.nestedSetLeftColumn!.propertyPath +
        ' BETWEEN ' +
        'joined.' +
        this.metadata.nestedSetLeftColumn!.propertyPath +
        ' AND joined.' +
        this.metadata.nestedSetRightColumn!.propertyPath;
      const parameters: ObjectLiteral = {};
      const joinCondition = this.metadata
        .treeParentRelation!.joinColumns.map((joinColumn) => {
          const parameterName =
            joinColumn.referencedColumn!.propertyPath.replace('.', '_');
          parameters[parameterName] =
            joinColumn.referencedColumn!.getEntityValue(entity);
          return (
            'joined.' +
            joinColumn.referencedColumn!.propertyPath +
            ' = :' +
            parameterName
          );
        })
        .join(' AND ');

      return this.createQueryBuilder(alias)
        .innerJoin(this.metadata.targetName, 'joined', whereCondition)
        .where(joinCondition, parameters) as SelectQueryBuilder<Entity>;
    } else if (this.metadata.treeType === 'materialized-path') {
      return this.createQueryBuilder(alias).where((qb) => {
        const subQuery = qb
          .subQuery()
          .select(
            `${this.metadata.targetName}.${
              this.metadata.materializedPathColumn!.propertyPath
            }`,
            'path'
          )
          .from(this.metadata.target, this.metadata.targetName)
          .whereInIds(this.metadata.getEntityIdMap(entity));

        return `${alias}.${
          this.metadata.materializedPathColumn!.propertyPath
        } LIKE NULLIF(CONCAT(${subQuery.getQuery()}, '%'), '%')`;
      }) as SelectQueryBuilder<Entity>;
    }

    throw new TypeORMError(`Supported only in tree entities`);
  }

  /**
   * Gets all parents (ancestors) of the given entity. Returns them all in a flat array.
   */
  public findAncestors(
    entity: Entity,
    options?: FindTreeOptions
  ): Promise<Array<Entity>> {
    const qb = this.createAncestorsQueryBuilder(
      'treeEntity',
      'treeClosure',
      entity
    );
    FindOptionsUtils.applyOptionsToTreeQueryBuilder(qb, options);
    return qb.getMany();
  }

  /**
   * Gets all parents (ancestors) of the given entity. Returns them in a tree - nested into each other.
   */
  public async findAncestorsTree(
    entity: Entity,
    options?: FindTreeOptions
  ): Promise<Entity> {
    // todo: throw exception if there is no column of this relation?
    const qb = this.createAncestorsQueryBuilder(
      'treeEntity',
      'treeClosure',
      entity
    );
    FindOptionsUtils.applyOptionsToTreeQueryBuilder(qb, options);

    const entities = await qb.getRawAndEntities();
    const relationMaps = TreeRepositoryUtils.createRelationMaps(
      this.manager,
      this.metadata,
      'treeEntity',
      entities.raw as Array<Record<string, unknown>>
    );
    TreeRepositoryUtils.buildParentEntityTree(
      this.metadata,
      entity,
      entities.entities,
      relationMaps
    );
    return entity;
  }

  /**
   * Gets number of ancestors of the entity.
   */
  public countAncestors(entity: Entity): Promise<number> {
    return this.createAncestorsQueryBuilder(
      'treeEntity',
      'treeClosure',
      entity
    ).getCount();
  }

  /**
   * Creates a query builder used to get ancestors of the entities in the tree.
   */
  public createAncestorsQueryBuilder(
    alias: string,
    closureTableAlias: string,
    entity: Entity
  ): SelectQueryBuilder<Entity> {
    // create shortcuts for better readability
    // const escape = (alias: string) => this.manager.connection.driver.escape(alias);

    if (this.metadata.treeType === 'closure-table') {
      const joinCondition = this.metadata.closureJunctionTable.ancestorColumns
        .map((column) => {
          return (
            closureTableAlias +
            '.' +
            column.propertyPath +
            ' = ' +
            alias +
            '.' +
            column.referencedColumn!.propertyPath
          );
        })
        .join(' AND ');

      const parameters: ObjectLiteral = {};
      const whereCondition =
        this.metadata.closureJunctionTable.descendantColumns
          .map((column) => {
            parameters[column.referencedColumn!.propertyName] =
              column.referencedColumn!.getEntityValue(entity);
            return (
              closureTableAlias +
              '.' +
              column.propertyPath +
              ' = :' +
              column.referencedColumn!.propertyName
            );
          })
          .join(' AND ');

      return this.createQueryBuilder(alias)
        .innerJoin(
          this.metadata.closureJunctionTable.tableName,
          closureTableAlias,
          joinCondition
        )
        .where(whereCondition)
        .setParameters(parameters) as SelectQueryBuilder<Entity>;
    } else if (this.metadata.treeType === 'nested-set') {
      const joinCondition =
        'joined.' +
        this.metadata.nestedSetLeftColumn!.propertyPath +
        ' BETWEEN ' +
        alias +
        '.' +
        this.metadata.nestedSetLeftColumn!.propertyPath +
        ' AND ' +
        alias +
        '.' +
        this.metadata.nestedSetRightColumn!.propertyPath;
      const parameters: ObjectLiteral = {};
      const whereCondition = this.metadata
        .treeParentRelation!.joinColumns.map((joinColumn) => {
          const parameterName =
            joinColumn.referencedColumn!.propertyPath.replace('.', '_');
          parameters[parameterName] =
            joinColumn.referencedColumn!.getEntityValue(entity);
          return (
            'joined.' +
            joinColumn.referencedColumn!.propertyPath +
            ' = :' +
            parameterName
          );
        })
        .join(' AND ');

      return this.createQueryBuilder(alias)
        .innerJoin(this.metadata.targetName, 'joined', joinCondition)
        .where(whereCondition, parameters) as SelectQueryBuilder<Entity>;
    } else if (this.metadata.treeType === 'materialized-path') {
      // example: SELECT * FROM category category WHERE (SELECT mpath FROM `category` WHERE id = 2) LIKE CONCAT(category.mpath, '%');
      return this.createQueryBuilder(alias).where((qb) => {
        const subQuery = qb
          .subQuery()
          .select(
            `${this.metadata.targetName}.${
              this.metadata.materializedPathColumn!.propertyPath
            }`,
            'path'
          )
          .from(this.metadata.target, this.metadata.targetName)
          .whereInIds(this.metadata.getEntityIdMap(entity));

        return `${subQuery.getQuery()} LIKE CONCAT(${alias}.${
          this.metadata.materializedPathColumn!.propertyPath
        }, '%')`;
      }) as SelectQueryBuilder<Entity>;
    }

    throw new TypeORMError(`Supported only in tree entities`);
  }
}
