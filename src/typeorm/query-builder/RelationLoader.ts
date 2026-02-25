import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { DataSource } from '../data-source/DataSource.js';
import { FindOptionsUtils } from '../find-options/FindOptionsUtils.js';
import type { RelationMetadata } from '../metadata/RelationMetadata.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';

import type { SelectQueryBuilder } from './SelectQueryBuilder.js';

/**
 * Wraps entities and creates getters/setters for their relations
 * to be able to lazily load relations when accessing these relations.
 */
export class RelationLoader {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(private connection: DataSource) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Loads relation data for the given entity and its relation.
   */
  public load(
    relation: RelationMetadata,
    entityOrEntities: ObjectLiteral | Array<ObjectLiteral>,
    queryRunner?: QueryRunner,
    queryBuilder?: SelectQueryBuilder<ObjectLiteral>
  ): Promise<Array<unknown>> {
    // todo: check all places where it uses non array
    if (queryRunner && queryRunner.isReleased) queryRunner = undefined; // get new one if already closed
    if (relation.isManyToOne || relation.isOneToOneOwner) {
      return this.loadManyToOneOrOneToOneOwner(
        relation,
        entityOrEntities,
        queryRunner,
        queryBuilder
      );
    } else if (relation.isOneToMany || relation.isOneToOneNotOwner) {
      return this.loadOneToManyOrOneToOneNotOwner(
        relation,
        entityOrEntities,
        queryRunner,
        queryBuilder
      );
    } else if (relation.isManyToManyOwner) {
      return this.loadManyToManyOwner(
        relation,
        entityOrEntities,
        queryRunner,
        queryBuilder
      );
    } else {
      // many-to-many non owner
      return this.loadManyToManyNotOwner(
        relation,
        entityOrEntities,
        queryRunner,
        queryBuilder
      );
    }
  }

  /**
   * Loads data for many-to-one and one-to-one owner relations.
   *
   * (ow) post.category<=>category.post
   * loaded: category from post
   * example: SELECT category.id AS category_id, category.name AS category_name FROM category category
   *              INNER JOIN post Post ON Post.category=category.id WHERE Post.id=1
   */
  public loadManyToOneOrOneToOneOwner(
    relation: RelationMetadata,
    entityOrEntities: ObjectLiteral | Array<ObjectLiteral>,
    queryRunner?: QueryRunner,
    queryBuilder?: SelectQueryBuilder<ObjectLiteral>
  ): Promise<Array<ObjectLiteral>> {
    const entities = Array.isArray(entityOrEntities)
      ? entityOrEntities
      : [entityOrEntities];

    const joinAliasName = relation.entityMetadata.name;
    const qb = queryBuilder
      ? queryBuilder
      : this.connection
          .createQueryBuilder(queryRunner)
          .select(relation.propertyName) // category
          .from(relation.type, relation.propertyName);

    const mainAlias = qb.expressionMap.mainAlias!.name;
    const columns = relation.entityMetadata.primaryColumns;
    const joinColumns = relation.isOwning
      ? relation.joinColumns
      : relation.inverseRelation!.joinColumns;
    const conditions = joinColumns
      .map((joinColumn) => {
        return `${relation.entityMetadata.name}.${
          joinColumn.propertyName
        } = ${mainAlias}.${joinColumn.referencedColumn!.propertyName!}`;
      })
      .join(' AND ');

    qb.innerJoin(
      relation.entityMetadata.target as () => unknown,
      joinAliasName,
      conditions
    );

    if (columns.length === 1) {
      const column = columns[0]!;
      qb.where(
        `${joinAliasName}.${column.propertyPath!} IN (:...${
          joinAliasName + '_' + column.propertyName!
        })`
      );
      qb.setParameter(
        joinAliasName + '_' + column.propertyName!,
        entities.map((entity) => column.getEntityValue(entity, true))
      );
    } else {
      const condition = entities
        .map((entity, entityIndex) => {
          return columns
            .map((column, columnIndex) => {
              const paramName =
                joinAliasName + '_entity_' + entityIndex + '_' + columnIndex;
              qb.setParameter(paramName, column.getEntityValue(entity, true));
              return (
                joinAliasName + '.' + column.propertyPath! + ' = :' + paramName
              );
            })
            .join(' AND ');
        })
        .map((condition) => '(' + condition + ')')
        .join(' OR ');
      qb.where(condition);
    }

    FindOptionsUtils.joinEagerRelations(
      qb,
      qb.alias,
      qb.expressionMap.mainAlias!.metadata
    );

    return qb.getMany() as Promise<Array<ObjectLiteral>>;
    // return qb.getOne(); todo: fix all usages
  }

  /**
   * Loads data for one-to-many and one-to-one not owner relations.
   *
   * SELECT post
   * FROM post post
   * WHERE post.[joinColumn.name] = entity[joinColumn.referencedColumn]
   */
  public loadOneToManyOrOneToOneNotOwner(
    relation: RelationMetadata,
    entityOrEntities: ObjectLiteral | Array<ObjectLiteral>,
    queryRunner?: QueryRunner,
    queryBuilder?: SelectQueryBuilder<ObjectLiteral>
  ): Promise<Array<ObjectLiteral>> {
    const entities = Array.isArray(entityOrEntities)
      ? entityOrEntities
      : [entityOrEntities];
    const columns = relation.inverseRelation!.joinColumns;
    const qb = queryBuilder
      ? queryBuilder
      : this.connection
          .createQueryBuilder(queryRunner)
          .select(relation.propertyName)
          .from(
            relation.inverseRelation!.entityMetadata.target,
            relation.propertyName
          );

    const aliasName = qb.expressionMap.mainAlias!.name;

    if (columns.length === 1) {
      const column = columns[0]!;
      qb.where(
        `${aliasName}.${column.propertyPath!} IN (:...${
          aliasName + '_' + column.propertyName!
        })`
      );
      qb.setParameter(
        aliasName + '_' + column.propertyName!,
        entities.map((entity) =>
          column.referencedColumn!.getEntityValue(entity, true)
        )
      );
    } else {
      const condition = entities
        .map((entity, entityIndex) => {
          return columns
            .map((column, columnIndex) => {
              const paramName =
                aliasName + '_entity_' + entityIndex + '_' + columnIndex;
              qb.setParameter(
                paramName,
                column.referencedColumn!.getEntityValue(entity, true)
              );
              return (
                aliasName + '.' + column.propertyPath! + ' = :' + paramName
              );
            })
            .join(' AND ');
        })
        .map((condition) => '(' + condition + ')')
        .join(' OR ');
      qb.where(condition);
    }

    FindOptionsUtils.joinEagerRelations(
      qb,
      qb.alias,
      qb.expressionMap.mainAlias!.metadata
    );

    return qb.getMany() as Promise<Array<ObjectLiteral>>;
    // return relation.isOneToMany ? qb.getMany() : qb.getOne(); todo: fix all usages
  }

  /**
   * Loads data for many-to-many owner relations.
   *
   * SELECT category
   * FROM category category
   * INNER JOIN post_categories post_categories
   * ON post_categories.postId = :postId
   * AND post_categories.categoryId = category.id
   */
  public loadManyToManyOwner(
    relation: RelationMetadata,
    entityOrEntities: ObjectLiteral | Array<ObjectLiteral>,
    queryRunner?: QueryRunner,
    queryBuilder?: SelectQueryBuilder<ObjectLiteral>
  ): Promise<Array<ObjectLiteral>> {
    const entities = Array.isArray(entityOrEntities)
      ? entityOrEntities
      : [entityOrEntities];
    const parameters = relation.joinColumns.reduce((parameters, joinColumn) => {
      parameters[joinColumn.propertyName] = entities.map((entity) =>
        joinColumn.referencedColumn!.getEntityValue(entity, true)
      );
      return parameters;
    }, {} as ObjectLiteral);

    const qb = queryBuilder
      ? queryBuilder
      : this.connection
          .createQueryBuilder(queryRunner)
          .select(relation.propertyName)
          .from(relation.type, relation.propertyName);

    const mainAlias = qb.expressionMap.mainAlias!.name;
    const joinAlias = relation.junctionEntityMetadata!.tableName;
    const joinColumnConditions = relation.joinColumns.map((joinColumn) => {
      return `${joinAlias}.${joinColumn.propertyName} IN (:...${joinColumn.propertyName})`;
    });
    const inverseJoinColumnConditions = relation.inverseJoinColumns.map(
      (inverseJoinColumn) => {
        return `${joinAlias}.${inverseJoinColumn.propertyName}=${mainAlias}.${
          inverseJoinColumn.referencedColumn!.propertyName
        }`;
      }
    );

    qb.innerJoin(
      joinAlias,
      joinAlias,
      [...joinColumnConditions, ...inverseJoinColumnConditions].join(' AND ')
    ).setParameters(parameters);

    FindOptionsUtils.joinEagerRelations(
      qb,
      qb.alias,
      qb.expressionMap.mainAlias!.metadata
    );

    return qb.getMany() as Promise<Array<ObjectLiteral>>;
  }

  /**
   * Loads data for many-to-many not owner relations.
   *
   * SELECT post
   * FROM post post
   * INNER JOIN post_categories post_categories
   * ON post_categories.postId = post.id
   * AND post_categories.categoryId = post_categories.categoryId
   */
  public loadManyToManyNotOwner(
    relation: RelationMetadata,
    entityOrEntities: ObjectLiteral | Array<ObjectLiteral>,
    queryRunner?: QueryRunner,
    queryBuilder?: SelectQueryBuilder<ObjectLiteral>
  ): Promise<Array<ObjectLiteral>> {
    const entities = Array.isArray(entityOrEntities)
      ? entityOrEntities
      : [entityOrEntities];

    const qb = queryBuilder
      ? queryBuilder
      : this.connection
          .createQueryBuilder(queryRunner)
          .select(relation.propertyName)
          .from(relation.type, relation.propertyName);

    const mainAlias = qb.expressionMap.mainAlias!.name;
    const joinAlias = relation.junctionEntityMetadata!.tableName;
    const joinColumnConditions = relation.inverseRelation!.joinColumns.map(
      (joinColumn) => {
        return `${joinAlias}.${
          joinColumn.propertyName
        } = ${mainAlias}.${joinColumn.referencedColumn!.propertyName}`;
      }
    );
    const inverseJoinColumnConditions =
      relation.inverseRelation!.inverseJoinColumns.map((inverseJoinColumn) => {
        return `${joinAlias}.${inverseJoinColumn.propertyName} IN (:...${inverseJoinColumn.propertyName})`;
      });
    const parameters = relation.inverseRelation!.inverseJoinColumns.reduce(
      (parameters, joinColumn) => {
        parameters[joinColumn.propertyName] = entities.map((entity) =>
          joinColumn.referencedColumn!.getEntityValue(entity, true)
        );
        return parameters;
      },
      {} as ObjectLiteral
    );

    qb.innerJoin(
      joinAlias,
      joinAlias,
      [...joinColumnConditions, ...inverseJoinColumnConditions].join(' AND ')
    ).setParameters(parameters);

    FindOptionsUtils.joinEagerRelations(
      qb,
      qb.alias,
      qb.expressionMap.mainAlias!.metadata
    );

    return qb.getMany() as Promise<Array<ObjectLiteral>>;
  }

  /**
   * Wraps given entity and creates getters/setters for its given relation
   * to be able to lazily load data when accessing this relation.
   */
  public enableLazyLoad(
    relation: RelationMetadata,
    entity: ObjectLiteral,
    queryRunner?: QueryRunner
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const relationLoader = this;
    const dataIndex = '__' + relation.propertyName + '__'; // in what property of the entity loaded data will be stored
    const promiseIndex = '__promise_' + relation.propertyName + '__'; // in what property of the entity loading promise will be stored
    const resolveIndex = '__has_' + relation.propertyName + '__'; // indicates if relation data already was loaded or not, we need this flag if loaded data is empty

    const setData = (entity: ObjectLiteral, value: unknown): unknown => {
      entity[dataIndex] = value;
      entity[resolveIndex] = true;
      delete entity[promiseIndex];
      return value;
    };
    const setPromise = (
      entity: ObjectLiteral,
      value: Promise<unknown>
    ): unknown => {
      delete entity[resolveIndex];
      delete entity[dataIndex];
      entity[promiseIndex] = value;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      value.then(
        // ensure different value is not assigned yet
        (result) =>
          entity[promiseIndex] === value ? setData(entity, result) : result
      );
      return value;
    };

    Object.defineProperty(entity, relation.propertyName, {
      get: function () {
        if (
          (this as unknown as ObjectLiteral)[resolveIndex] === true ||
          (this as unknown as ObjectLiteral)[dataIndex] !== undefined
        )
          // if related data already was loaded then simply return it
          return Promise.resolve((this as unknown as ObjectLiteral)[dataIndex]);

        if ((this as unknown as ObjectLiteral)[promiseIndex])
          // if related data is loading then return a promise relationLoader loads it
          return (this as unknown as ObjectLiteral)[promiseIndex];

        // nothing is loaded yet, load relation data and save it in the model once they are loaded
        const loader = relationLoader
          .load(relation, this as unknown as ObjectLiteral, queryRunner)
          .then((result) =>
            relation.isOneToOne || relation.isManyToOne
              ? result.length === 0
                ? null
                : result[0]
              : result
          );
        return setPromise(this as unknown as ObjectLiteral, loader);
      },
      set: function (value: unknown | Promise<unknown>) {
        if (value instanceof Promise) {
          // if set data is a promise then wait for its resolve and save in the object

          setPromise(this as unknown as ObjectLiteral, value);
        } else {
          // if its direct data set (non promise, probably not safe-typed)
          setData(this as unknown as ObjectLiteral, value);
        }
      },
      configurable: true,
      enumerable: false,
    });
  }
}
