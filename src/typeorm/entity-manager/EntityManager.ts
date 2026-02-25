import type { TFunction } from '../../types/utility.types.js';
import type { DeepPartial } from '../common/DeepPartial.js';
import type { EntityTarget } from '../common/EntityTarget.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { PickKeysByType } from '../common/PickKeysByType.js';
import { DataSource } from '../data-source/DataSource.js';
import type { Driver } from '../driver/Driver.js';
import type { IsolationLevel } from '../driver/types/IsolationLevel.js';
import { EntityNotFoundError } from '../error/EntityNotFoundError.js';
import { NoNeedToReleaseEntityManagerError } from '../error/NoNeedToReleaseEntityManagerError.js';
import { QueryRunnerProviderAlreadyReleasedError } from '../error/QueryRunnerProviderAlreadyReleasedError.js';
import { TreeRepositoryNotSupportedError } from '../error/TreeRepositoryNotSupportedError.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { FindManyOptions } from '../find-options/FindManyOptions.js';
import type { FindOneOptions } from '../find-options/FindOneOptions.js';
import { FindOptionsUtils } from '../find-options/FindOptionsUtils.js';
import type { FindOptionsWhere } from '../find-options/FindOptionsWhere.js';
import { EntityPersistExecutor } from '../persistence/EntityPersistExecutor.js';
import type { QueryDeepPartialEntity } from '../query-builder/QueryPartialEntity.js';
import { DeleteResult } from '../query-builder/result/DeleteResult.js';
import { InsertResult } from '../query-builder/result/InsertResult.js';
import { UpdateResult } from '../query-builder/result/UpdateResult.js';
import { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';
import { PlainObjectToDatabaseEntityTransformer } from '../query-builder/transformer/PlainObjectToDatabaseEntityTransformer.js';
import { PlainObjectToNewEntityTransformer } from '../query-builder/transformer/PlainObjectToNewEntityTransformer.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
// MongoRepository import removed - module not found
// import { MongoRepository } from '../repository/MongoRepository.js';
import type { RemoveOptions } from '../repository/RemoveOptions.js';
import { Repository } from '../repository/Repository.js';
import type { SaveOptions } from '../repository/SaveOptions.js';
import { TreeRepository } from '../repository/TreeRepository.js';
import type { UpsertOptions } from '../repository/UpsertOptions.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { ObjectUtils } from '../util/ObjectUtils.js';
import { OrmUtils } from '../util/OrmUtils.js';
import { buildSqlTag } from '../util/SqlTagUtils.js';

/**
 * Entity manager supposed to work with any entity, automatically find its repository and call its methods,
 * whatever entity type are you passing.
 */
export class EntityManager {
  public readonly '@instanceof' = Symbol.for('EntityManager');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Connection used by this entity manager.
   */
  public readonly connection: DataSource;

  /**
   * Custom query runner to be used for operations in this entity manager.
   * Used only in non-global entity manager.
   */
  public readonly queryRunner?: QueryRunner;

  /**
   * Driver used by this entity manager.
   */
  public get driver(): Driver {
    return this.connection.driver;
  }

  // -------------------------------------------------------------------------
  // Protected Properties
  // -------------------------------------------------------------------------

  /**
   * Once created and then reused by repositories.
   * Created as a future replacement for the #repositories to provide a bit more perf optimization.
   */
  protected repositories = new Map<
    EntityTarget<ObjectLiteral>,
    Repository<ObjectLiteral>
  >();

  /**
   * Once created and then reused by repositories.
   */
  protected treeRepositories: Array<TreeRepository<ObjectLiteral>> = [];

  /**
   * Plain to object transformer used in create and merge operations.
   */
  protected plainObjectToEntityTransformer =
    new PlainObjectToNewEntityTransformer();

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(connection: DataSource, queryRunner?: QueryRunner) {
    this.connection = connection;
    if (queryRunner) {
      this.queryRunner = queryRunner;
      // dynamic: this.queryRunner = manager;
      ObjectUtils.assign(this.queryRunner, { manager: this });
    }
  }

  /**
   * Wraps given function execution (and all operations made there) in a transaction.
   * All database operations must be executed using provided entity manager.
   */
  public async transaction<T>(
    isolationOrRunInTransaction:
      | IsolationLevel
      | ((entityManager: EntityManager) => Promise<T>),
    runInTransactionParam?: (entityManager: EntityManager) => Promise<T>
  ): Promise<T> {
    const isolation =
      typeof isolationOrRunInTransaction === 'string'
        ? isolationOrRunInTransaction
        : undefined;
    const runInTransaction =
      typeof isolationOrRunInTransaction === 'function'
        ? isolationOrRunInTransaction
        : runInTransactionParam;

    if (!runInTransaction) {
      throw new TypeORMError(
        `Transaction method requires callback in second parameter if isolation level is supplied.`
      );
    }

    if (this.queryRunner && this.queryRunner.isReleased)
      throw new QueryRunnerProviderAlreadyReleasedError();

    // if query runner is already defined in this class, it means this entity manager was already created for a single connection
    // if its not defined we create a new query runner - single connection where we'll execute all our operations
    const queryRunner: QueryRunner =
      this.queryRunner ?? this.connection.createQueryRunner();

    try {
      await queryRunner.startTransaction(isolation);
      const result = await runInTransaction(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      try {
        // we throw original error even if rollback thrown an error
        await queryRunner.rollbackTransaction();
      } catch {
        // do nothing
      }
      throw err;
    } finally {
      if (!this.queryRunner)
        // if we used a new query runner provider then release it
        await queryRunner.release();
    }
  }

  /**
   * Executes raw SQL query and returns raw database results.
   *
   * @see [Official docs](https://typeorm.io/docs/Working%20with%20Entity%20Manager/entity-manager-api/) for examples.
   */
  public async query<T = unknown>(
    query: string,
    parameters?: Array<unknown>
  ): Promise<T> {
    return this.connection.query(query, parameters, this.queryRunner);
  }

  /**
   * Tagged template function that executes raw SQL query and returns raw database results.
   * Template expressions are automatically transformed into database parameters.
   * Raw query execution is supported only by relational databases (MongoDB is not supported).
   * Note: Don't call this as a regular function, it is meant to be used with backticks to tag a template literal.
   * Example: entityManager.sql`SELECT * FROM table_name WHERE id = ${id}`
   */
  public async sql<T = unknown>(
    strings: TemplateStringsArray,
    ...values: Array<unknown>
  ): Promise<T> {
    const { query, parameters } = buildSqlTag({
      driver: this.connection.driver,
      strings: strings,
      expressions: values,
    });

    return await this.query(query, parameters);
  }

  /**
   * Creates a new query builder that can be used to build a SQL query.
   */
  public createQueryBuilder<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    alias: string,
    queryRunner?: QueryRunner
  ): SelectQueryBuilder<Entity>;

  /**
   * Creates a new query builder that can be used to build a SQL query.
   */
  public createQueryBuilder(
    queryRunner?: QueryRunner
  ): SelectQueryBuilder<ObjectLiteral>;

  /**
   * Creates a new query builder that can be used to build a SQL query.
   */
  public createQueryBuilder<Entity extends ObjectLiteral>(
    entityClass?: EntityTarget<Entity> | QueryRunner,
    alias?: string,
    queryRunner?: QueryRunner
  ): SelectQueryBuilder<ObjectLiteral> {
    if (alias) {
      return this.connection.createQueryBuilder(
        entityClass as EntityTarget<Entity>,
        alias,
        queryRunner ?? this.queryRunner
      ) as SelectQueryBuilder<ObjectLiteral>;
    } else {
      return this.connection.createQueryBuilder(
        (entityClass as QueryRunner | undefined) ??
          queryRunner ??
          this.queryRunner
      );
    }
  }

  /**
   * Checks if entity has an id.
   */
  public hasId(entity: unknown): boolean;

  /**
   * Checks if entity of given schema name has an id.
   */
  public hasId(target: TFunction | string, entity: unknown): boolean;

  /**
   * Checks if entity has an id by its TFunction type or schema name.
   */
  public hasId(
    targetOrEntity: unknown | TFunction | string,
    maybeEntity?: unknown
  ): boolean {
    const target =
      arguments.length === 2
        ? targetOrEntity
        : (targetOrEntity as object).constructor;
    const entity = arguments.length === 2 ? maybeEntity : targetOrEntity;
    const metadata = this.connection.getMetadata(
      target as EntityTarget<ObjectLiteral>
    );
    return metadata.hasId(entity as ObjectLiteral);
  }

  /**
   * Gets entity mixed id.
   */
  public getId(entity: unknown): unknown;

  /**
   * Gets entity mixed id.
   */
  public getId(target: EntityTarget<unknown>, entity: unknown): unknown;

  /**
   * Gets entity mixed id.
   */
  public getId(
    targetOrEntity: unknown | EntityTarget<unknown>,
    maybeEntity?: unknown
  ): unknown {
    const target =
      arguments.length === 2
        ? targetOrEntity
        : (targetOrEntity as object).constructor;
    const entity = arguments.length === 2 ? maybeEntity : targetOrEntity;
    const metadata = this.connection.getMetadata(
      target as EntityTarget<ObjectLiteral>
    );
    return metadata.getEntityIdMixedMap(entity as ObjectLiteral);
  }

  /**
   * Creates a new entity instance and copies all entity properties from this object into a new entity.
   * Note that it copies only properties that present in entity schema.
   */
  public create<Entity, EntityLike extends DeepPartial<Entity>>(
    entityClass: EntityTarget<Entity>,
    plainObject?: EntityLike
  ): Entity;

  /**
   * Creates a new entities and copies all entity properties from given objects into their new entities.
   * Note that it copies only properties that present in entity schema.
   */
  public create<Entity, EntityLike extends DeepPartial<Entity>>(
    entityClass: EntityTarget<Entity>,
    plainObjects?: Array<EntityLike>
  ): Array<Entity>;

  /**
   * Creates a new entity instance or instances.
   * Can copy properties from the given object into new entities.
   */
  public create<
    Entity extends ObjectLiteral,
    EntityLike extends DeepPartial<Entity>,
  >(
    entityClass: EntityTarget<Entity>,
    plainObjectOrObjects?: EntityLike | Array<EntityLike>
  ): Entity | Array<Entity> {
    const metadata = this.connection.getMetadata(entityClass);

    if (!plainObjectOrObjects)
      return metadata.create(this.queryRunner) as Entity;

    if (Array.isArray(plainObjectOrObjects))
      return (plainObjectOrObjects as Array<EntityLike>).map(
        (plainEntityLike) => this.create(entityClass, plainEntityLike)
      );

    const mergeIntoEntity = metadata.create(this.queryRunner) as Entity;
    this.plainObjectToEntityTransformer.transform(
      mergeIntoEntity,
      plainObjectOrObjects as unknown as ObjectLiteral,
      metadata,
      true
    );
    return mergeIntoEntity;
  }

  /**
   * Merges two entities into one new entity.
   */
  public merge<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    mergeIntoEntity: Entity,
    ...entityLikes: Array<DeepPartial<Entity>>
  ): Entity {
    // todo: throw exception if entity manager is released
    const metadata = this.connection.getMetadata(entityClass);
    entityLikes.forEach((object) =>
      this.plainObjectToEntityTransformer.transform(
        mergeIntoEntity,
        object,
        metadata
      )
    );
    return mergeIntoEntity;
  }

  /**
   * Creates a new entity from the given plain javascript object. If entity already exist in the database, then
   * it loads it (and everything related to it), replaces all values with the new ones from the given object
   * and returns this new entity. This new entity is actually a loaded from the db entity with all properties
   * replaced from the new object.
   */
  public async preload<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    entityLike: DeepPartial<Entity>
  ): Promise<Entity | undefined> {
    const metadata = this.connection.getMetadata(entityClass);
    const plainObjectToDatabaseEntityTransformer =
      new PlainObjectToDatabaseEntityTransformer(this.connection.manager);
    const transformedEntity =
      await plainObjectToDatabaseEntityTransformer.transform(
        entityLike,
        metadata
      );
    if (transformedEntity)
      return this.merge(entityClass, transformedEntity as Entity, entityLike);

    return undefined;
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  public save<Entity>(
    entities: Array<Entity>,
    options?: SaveOptions
  ): Promise<Array<Entity>>;

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  public save<Entity>(entity: Entity, options?: SaveOptions): Promise<Entity>;

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  public save<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entities: Array<T>,
    options: SaveOptions & { reload: false }
  ): Promise<Array<T>>;

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  public save<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entities: Array<T>,
    options?: SaveOptions
  ): Promise<Array<T & Entity>>;

  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  public save<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entity: T,
    options: SaveOptions & { reload: false }
  ): Promise<T>;

  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  public save<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entity: T,
    options?: SaveOptions
  ): Promise<T & Entity>;

  /**
   * Saves a given entity in the database.
   */
  public save<Entity extends ObjectLiteral, T extends DeepPartial<Entity>>(
    targetOrEntity: (T | Array<T>) | EntityTarget<Entity>,
    maybeEntityOrOptions?: T | Array<T>,
    maybeOptions?: SaveOptions
  ): Promise<T | Array<T>> {
    // normalize mixed parameters
    let target =
      arguments.length > 1 &&
      (typeof targetOrEntity === 'function' ||
        InstanceChecker.isEntitySchema(targetOrEntity) ||
        typeof targetOrEntity === 'string')
        ? (targetOrEntity as TFunction | string)
        : undefined;
    const entity: T | Array<T> = target
      ? (maybeEntityOrOptions as T | Array<T>)
      : (targetOrEntity as T | Array<T>);
    const options = target
      ? maybeOptions
      : (maybeEntityOrOptions as SaveOptions);

    if (InstanceChecker.isEntitySchema(target)) target = target.options.name;

    // if user passed empty array of entities then we don't need to do anything
    if (Array.isArray(entity) && entity.length === 0)
      return Promise.resolve(entity);

    // execute save operation
    return new EntityPersistExecutor(
      this.connection,
      this.queryRunner,
      'save',
      () => target,
      entity,
      options
    )
      .execute()
      .then(() => entity);
  }

  /**
   * Removes a given entity from the database.
   */
  public remove<Entity>(
    entity: Entity,
    options?: RemoveOptions
  ): Promise<Entity>;

  /**
   * Removes a given entity from the database.
   */
  public remove<Entity>(
    targetOrEntity: EntityTarget<Entity>,
    entity: Entity,
    options?: RemoveOptions
  ): Promise<Entity>;

  /**
   * Removes a given entity from the database.
   */
  public remove<Entity>(
    entity: Array<Entity>,
    options?: RemoveOptions
  ): Promise<Entity>;

  /**
   * Removes a given entity from the database.
   */
  public remove<Entity>(
    targetOrEntity: EntityTarget<Entity>,
    entity: Array<Entity>,
    options?: RemoveOptions
  ): Promise<Array<Entity>>;

  /**
   * Removes a given entity from the database.
   */
  public remove<Entity extends ObjectLiteral>(
    targetOrEntity: (Entity | Array<Entity>) | EntityTarget<Entity>,
    maybeEntityOrOptions?: Entity | Array<Entity>,
    maybeOptions?: RemoveOptions
  ): Promise<Entity | Array<Entity>> {
    // normalize mixed parameters
    const target =
      arguments.length > 1 &&
      (typeof targetOrEntity === 'function' ||
        InstanceChecker.isEntitySchema(targetOrEntity) ||
        typeof targetOrEntity === 'string')
        ? (targetOrEntity as TFunction | string)
        : undefined;
    const entity: Entity | Array<Entity> = target
      ? (maybeEntityOrOptions as Entity | Array<Entity>)
      : (targetOrEntity as Entity | Array<Entity>);
    const options = target
      ? maybeOptions
      : (maybeEntityOrOptions as SaveOptions);

    // if user passed empty array of entities then we don't need to do anything
    if (Array.isArray(entity) && entity.length === 0)
      return Promise.resolve(entity);

    // execute remove operation
    return new EntityPersistExecutor(
      this.connection,
      this.queryRunner,
      'remove',
      () => target,
      entity,
      options
    )
      .execute()
      .then(() => entity);
  }

  /**
   * Records the delete date of all given entities.
   */
  public softRemove<Entity>(
    entities: Array<Entity>,
    options?: SaveOptions
  ): Promise<Array<Entity>>;

  /**
   * Records the delete date of a given entity.
   */
  public softRemove<Entity>(
    entity: Entity,
    options?: SaveOptions
  ): Promise<Entity>;

  /**
   * Records the delete date of all given entities.
   */
  public softRemove<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entities: Array<T>,
    options?: SaveOptions
  ): Promise<Array<T>>;

  /**
   * Records the delete date of a given entity.
   */
  public softRemove<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entity: T,
    options?: SaveOptions
  ): Promise<T>;

  /**
   * Records the delete date of one or many given entities.
   */
  public softRemove<
    Entity extends ObjectLiteral,
    T extends DeepPartial<Entity>,
  >(
    targetOrEntity: (T | Array<T>) | EntityTarget<Entity>,
    maybeEntityOrOptions?: T | Array<T>,
    maybeOptions?: SaveOptions
  ): Promise<T | Array<T>> {
    // normalize mixed parameters
    let target =
      arguments.length > 1 &&
      (typeof targetOrEntity === 'function' ||
        InstanceChecker.isEntitySchema(targetOrEntity) ||
        typeof targetOrEntity === 'string')
        ? (targetOrEntity as TFunction | string)
        : undefined;
    const entity: T | Array<T> = target
      ? (maybeEntityOrOptions as T | Array<T>)
      : (targetOrEntity as T | Array<T>);
    const options = target
      ? maybeOptions
      : (maybeEntityOrOptions as SaveOptions);

    if (InstanceChecker.isEntitySchema(target)) target = target.options.name;

    // if user passed empty array of entities then we don't need to do anything
    if (Array.isArray(entity) && entity.length === 0)
      return Promise.resolve(entity);

    // execute soft-remove operation
    return new EntityPersistExecutor(
      this.connection,
      this.queryRunner,
      'soft-remove',
      () => target,
      entity,
      options
    )
      .execute()
      .then(() => entity);
  }

  /**
   * Recovers all given entities.
   */
  public recover<Entity>(
    entities: Array<Entity>,
    options?: SaveOptions
  ): Promise<Array<Entity>>;

  /**
   * Recovers a given entity.
   */
  public recover<Entity>(
    entity: Entity,
    options?: SaveOptions
  ): Promise<Entity>;

  /**
   * Recovers all given entities.
   */
  public recover<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entities: Array<T>,
    options?: SaveOptions
  ): Promise<Array<T>>;

  /**
   * Recovers a given entity.
   */
  public recover<Entity, T extends DeepPartial<Entity>>(
    targetOrEntity: EntityTarget<Entity>,
    entity: T,
    options?: SaveOptions
  ): Promise<T>;

  /**
   * Recovers one or many given entities.
   */
  public recover<Entity extends ObjectLiteral, T extends DeepPartial<Entity>>(
    targetOrEntity: (T | Array<T>) | EntityTarget<Entity>,
    maybeEntityOrOptions?: T | Array<T>,
    maybeOptions?: SaveOptions
  ): Promise<T | Array<T>> {
    // normalize mixed parameters
    let target =
      arguments.length > 1 &&
      (typeof targetOrEntity === 'function' ||
        InstanceChecker.isEntitySchema(targetOrEntity) ||
        typeof targetOrEntity === 'string')
        ? (targetOrEntity as TFunction | string)
        : undefined;
    const entity: T | Array<T> = target
      ? (maybeEntityOrOptions as T | Array<T>)
      : (targetOrEntity as T | Array<T>);
    const options = target
      ? maybeOptions
      : (maybeEntityOrOptions as SaveOptions);

    if (InstanceChecker.isEntitySchema(target)) target = target.options.name;

    // if user passed empty array of entities then we don't need to do anything
    if (Array.isArray(entity) && entity.length === 0)
      return Promise.resolve(entity);

    // execute recover operation
    return new EntityPersistExecutor(
      this.connection,
      this.queryRunner,
      'recover',
      () => target,
      entity,
      options
    )
      .execute()
      .then(() => entity);
  }

  /**
   * Inserts a given entity into the database.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient INSERT query.
   * Does not check if entity exist in the database, so query will fail if duplicate entity is being inserted.
   * You can execute bulk inserts using this method.
   */
  public async insert<Entity extends ObjectLiteral>(
    target: EntityTarget<Entity>,
    entity:
      | QueryDeepPartialEntity<Entity>
      | Array<QueryDeepPartialEntity<Entity>>
  ): Promise<InsertResult> {
    return this.createQueryBuilder()
      .insert()
      .into(target)
      .values(entity)
      .execute();
  }

  public async upsert<Entity extends ObjectLiteral>(
    target: EntityTarget<Entity>,
    entityOrEntities:
      | QueryDeepPartialEntity<Entity>
      | Array<QueryDeepPartialEntity<Entity>>,
    conflictPathsOrOptions: Array<string> | UpsertOptions<Entity>
  ): Promise<InsertResult> {
    const metadata = this.connection.getMetadata(target);

    let options: UpsertOptions<Entity>;

    if (Array.isArray(conflictPathsOrOptions)) {
      options = {
        conflictPaths: conflictPathsOrOptions,
      };
    } else {
      options = conflictPathsOrOptions;
    }

    let entities: Array<QueryDeepPartialEntity<Entity>>;

    if (!Array.isArray(entityOrEntities)) {
      entities = [entityOrEntities];
    } else {
      entities = entityOrEntities;
    }

    const conflictColumns = metadata.mapPropertyPathsToColumns(
      Array.isArray(options.conflictPaths)
        ? options.conflictPaths
        : Object.keys(options.conflictPaths)
    );

    const overwriteColumns = metadata.columns.filter(
      (col) =>
        !conflictColumns.includes(col) &&
        entities.some(
          (entity) => typeof col.getEntityValue(entity) !== 'undefined'
        )
    );

    return this.createQueryBuilder()
      .insert()
      .into(target)
      .values(entities)
      .orUpdate(
        [...conflictColumns, ...overwriteColumns].map(
          (col) => col.databaseName
        ),
        conflictColumns.map((col) => col.databaseName),
        {
          skipUpdateIfNoValuesChanged: options.skipUpdateIfNoValuesChanged,
          indexPredicate: options.indexPredicate,
          upsertType: options.upsertType || this.driver.supportedUpsertTypes[0],
        }
      )
      .execute();
  }

  /**
   * Updates entity partially. Entity can be found by a given condition(s).
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient UPDATE query.
   * Does not check if entity exist in the database.
   * Condition(s) cannot be empty.
   */
  public update<Entity extends ObjectLiteral>(
    target: EntityTarget<Entity>,
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | unknown,
    partialEntity: QueryDeepPartialEntity<Entity>
  ): Promise<UpdateResult> {
    // if user passed empty criteria or empty list of criterias, then throw an error
    if (OrmUtils.isCriteriaNullOrEmpty(criteria)) {
      return Promise.reject(
        new TypeORMError(
          `Empty criteria(s) are not allowed for the update method.`
        )
      );
    }

    if (OrmUtils.isPrimitiveCriteria(criteria)) {
      return this.createQueryBuilder()
        .update(target)
        .set(partialEntity)
        .whereInIds(criteria)
        .execute();
    } else {
      return this.createQueryBuilder()
        .update(target)
        .set(partialEntity)
        .where(criteria as ObjectLiteral)
        .execute();
    }
  }

  /**
   * Updates all entities of target type, setting fields from supplied partial entity.
   * This is a primitive operation without cascades, relations or other operations included.
   * Executes fast and efficient UPDATE query without WHERE clause.
   *
   * WARNING! This method updates ALL rows in the target table.
   */
  public updateAll<Entity extends ObjectLiteral>(
    target: EntityTarget<Entity>,
    partialEntity: QueryDeepPartialEntity<Entity>
  ): Promise<UpdateResult> {
    return this.createQueryBuilder()
      .update(target)
      .set(partialEntity)
      .execute();
  }

  /**
   * Deletes entities by a given condition(s).
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient DELETE query.
   * Does not check if entity exist in the database.
   * Condition(s) cannot be empty.
   */
  public delete<Entity extends ObjectLiteral>(
    targetOrEntity: EntityTarget<Entity>,
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | unknown
  ): Promise<DeleteResult> {
    // if user passed empty criteria or empty list of criterias, then throw an error
    if (OrmUtils.isCriteriaNullOrEmpty(criteria)) {
      return Promise.reject(
        new TypeORMError(
          `Empty criteria(s) are not allowed for the delete method.`
        )
      );
    }

    if (OrmUtils.isPrimitiveCriteria(criteria)) {
      return this.createQueryBuilder()
        .delete()
        .from(targetOrEntity)
        .whereInIds(criteria)
        .execute();
    } else {
      return this.createQueryBuilder()
        .delete()
        .from(targetOrEntity)
        .where(criteria as ObjectLiteral)
        .execute();
    }
  }

  /**
   * Deletes all entities of target type.
   * This is a primitive operation without cascades, relations or other operations included.
   * Executes fast and efficient DELETE query without WHERE clause.
   *
   * WARNING! This method deletes ALL rows in the target table.
   */
  public deleteAll<Entity extends ObjectLiteral>(
    targetOrEntity: EntityTarget<Entity>
  ): Promise<DeleteResult> {
    return this.createQueryBuilder().delete().from(targetOrEntity).execute();
  }

  /**
   * Records the delete date of entities by a given condition(s).
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient UPDATE query.
   * Does not check if entity exist in the database.
   * Condition(s) cannot be empty.
   */
  public softDelete<Entity extends ObjectLiteral>(
    targetOrEntity: EntityTarget<Entity>,
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | unknown
  ): Promise<UpdateResult> {
    // if user passed empty criteria or empty list of criterias, then throw an error
    if (OrmUtils.isCriteriaNullOrEmpty(criteria)) {
      return Promise.reject(
        new TypeORMError(
          `Empty criteria(s) are not allowed for the softDelete method.`
        )
      );
    }

    if (OrmUtils.isPrimitiveCriteria(criteria)) {
      return this.createQueryBuilder()
        .softDelete()
        .from(targetOrEntity)
        .whereInIds(criteria)
        .execute();
    } else {
      return this.createQueryBuilder()
        .softDelete()
        .from(targetOrEntity)
        .where(criteria as ObjectLiteral)
        .execute();
    }
  }

  /**
   * Restores entities by a given condition(s).
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient UPDATE query.
   * Does not check if entity exist in the database.
   * Condition(s) cannot be empty.
   */
  public restore<Entity extends ObjectLiteral>(
    targetOrEntity: EntityTarget<Entity>,
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | unknown
  ): Promise<UpdateResult> {
    // if user passed empty criteria or empty list of criterias, then throw an error
    if (OrmUtils.isCriteriaNullOrEmpty(criteria)) {
      return Promise.reject(
        new TypeORMError(
          `Empty criteria(s) are not allowed for the restore method.`
        )
      );
    }

    if (OrmUtils.isPrimitiveCriteria(criteria)) {
      return this.createQueryBuilder()
        .restore()
        .from(targetOrEntity)
        .whereInIds(criteria)
        .execute();
    } else {
      return this.createQueryBuilder()
        .restore()
        .from(targetOrEntity)
        .where(criteria as ObjectLiteral)
        .execute();
    }
  }

  /**
   * Checks whether any entity exists with the given options.
   */
  public exists<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    options?: FindManyOptions<Entity>
  ): Promise<boolean> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder(
      entityClass,
      FindOptionsUtils.extractFindManyOptionsAlias(options) || metadata.name
    )
      .setFindOptions(options || {})
      .getExists();
  }

  /**
   * Checks whether any entity exists with the given conditions.
   */
  public async existsBy<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<boolean> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder(entityClass, metadata.name)
      .setFindOptions({ where })
      .getExists();
  }

  /**
   * Counts entities that match given options.
   * Useful for pagination.
   */
  public count<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    options?: FindManyOptions<Entity>
  ): Promise<number> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder(
      entityClass,
      FindOptionsUtils.extractFindManyOptionsAlias(options) || metadata.name
    )
      .setFindOptions(options || {})
      .getCount();
  }

  /**
   * Counts entities that match given conditions.
   * Useful for pagination.
   */
  public countBy<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder(entityClass, metadata.name)
      .setFindOptions({ where })
      .getCount();
  }

  /**
   * Return the SUM of a column
   */
  public sum<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.callAggregateFun(entityClass, 'SUM', columnName, where);
  }

  /**
   * Return the AVG of a column
   */
  public average<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.callAggregateFun(entityClass, 'AVG', columnName, where);
  }

  /**
   * Return the MIN of a column
   */
  public minimum<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.callAggregateFun(entityClass, 'MIN', columnName, where);
  }

  /**
   * Return the MAX of a column
   */
  public maximum<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.callAggregateFun(entityClass, 'MAX', columnName, where);
  }

  private async callAggregateFun<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    fnName: 'SUM' | 'AVG' | 'MIN' | 'MAX',
    columnName: PickKeysByType<Entity, number>,
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>> = {}
  ): Promise<number | null> {
    const metadata = this.connection.getMetadata(entityClass);
    const column = metadata.columns.find(
      (item) => item.propertyPath === columnName
    );
    if (!column) {
      throw new TypeORMError(
        `Column "${columnName}" was not found in table "${metadata.name}"`
      );
    }

    const result = (await this.createQueryBuilder(entityClass, metadata.name)
      .setFindOptions({ where })
      .select(`${fnName}(${this.driver.escape(column.databaseName)})`, fnName)
      .getRawOne()) as Record<string, string> | null;
    return result?.[fnName] === null || result?.[fnName] === undefined
      ? null
      : parseFloat(result[fnName] as string);
  }

  /**
   * Finds entities that match given find options.
   */
  public async find<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    options?: FindManyOptions<Entity>
  ): Promise<Array<Entity>> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder<Entity>(
      entityClass,
      FindOptionsUtils.extractFindManyOptionsAlias(options) || metadata.name
    )
      .setFindOptions(options || {})
      .getMany();
  }

  /**
   * Finds entities that match given find options.
   */
  public async findBy<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<Array<Entity>> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder<Entity>(entityClass, metadata.name)
      .setFindOptions({ where: where })
      .getMany();
  }

  /**
   * Finds entities that match given find options.
   * Also counts all entities that match given conditions,
   * but ignores pagination settings (from and take options).
   */
  public findAndCount<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    options?: FindManyOptions<Entity>
  ): Promise<[Array<Entity>, number]> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder<Entity>(
      entityClass,
      FindOptionsUtils.extractFindManyOptionsAlias(options) || metadata.name
    )
      .setFindOptions(options || {})
      .getManyAndCount();
  }

  /**
   * Finds entities that match given WHERE conditions.
   * Also counts all entities that match given conditions,
   * but ignores pagination settings (from and take options).
   */
  public findAndCountBy<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<[Array<Entity>, number]> {
    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder<Entity>(entityClass, metadata.name)
      .setFindOptions({ where })
      .getManyAndCount();
  }

  /**
   * Finds entities with ids.
   * Optionally find options or conditions can be applied.
   *
   * @deprecated use `findBy` method instead in conjunction with `In` operator, for example:
   *
   * .findBy({
   *     id: In([1, 2, 3])
   * })
   */
  public async findByIds<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    ids: Array<unknown>
  ): Promise<Array<Entity>> {
    // if no ids passed, no need to execute a query - just return an empty array of values
    if (!ids.length) return Promise.resolve([]);

    const metadata = this.connection.getMetadata(entityClass);
    return this.createQueryBuilder<Entity>(entityClass, metadata.name)
      .andWhereInIds(ids)
      .getMany();
  }

  /**
   * Finds first entity by a given find options.
   * If entity was not found in the database - returns null.
   */
  public async findOne<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    options: FindOneOptions<Entity>
  ): Promise<Entity | null> {
    const metadata = this.connection.getMetadata(entityClass);

    // prepare alias for built query
    let alias: string = metadata.name;
    if (options && options.join) {
      alias = options.join.alias;
    }

    if (!options.where) {
      throw new Error(
        `You must provide selection conditions in order to find a single row.`
      );
    }

    // create query builder and apply find options
    return this.createQueryBuilder<Entity>(entityClass, alias)
      .setFindOptions({
        ...options,
        take: 1,
      })
      .getOne();
  }

  /**
   * Finds first entity that matches given where condition.
   * If entity was not found in the database - returns null.
   */
  public async findOneBy<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<Entity | null> {
    const metadata = this.connection.getMetadata(entityClass);

    // create query builder and apply find options
    return this.createQueryBuilder<Entity>(entityClass, metadata.name)
      .setFindOptions({
        where,
        take: 1,
      })
      .getOne();
  }

  /**
   * Finds first entity that matches given id.
   * If entity was not found in the database - returns null.
   *
   * @deprecated use `findOneBy` method instead in conjunction with `In` operator, for example:
   *
   * .findOneBy({
   *     id: 1 // where "id" is your primary column name
   * })
   */
  public async findOneById<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    id: number | string | Date
  ): Promise<Entity | null> {
    const metadata = this.connection.getMetadata(entityClass);

    // create query builder and apply find options
    return this.createQueryBuilder<Entity>(entityClass, metadata.name)
      .setFindOptions({
        take: 1,
      })
      .whereInIds(metadata.ensureEntityIdMap(id))
      .getOne();
  }

  /**
   * Finds first entity by a given find options.
   * If entity was not found in the database - rejects with error.
   */
  public async findOneOrFail<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    options: FindOneOptions<Entity>
  ): Promise<Entity> {
    return this.findOne<Entity>(entityClass, options).then((value) => {
      if (value === null) {
        return Promise.reject(new EntityNotFoundError(entityClass, options));
      }
      return Promise.resolve(value);
    });
  }

  /**
   * Finds first entity that matches given where condition.
   * If entity was not found in the database - rejects with error.
   */
  public async findOneByOrFail<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<Entity> {
    return this.findOneBy<Entity>(entityClass, where).then((value) => {
      if (value === null) {
        return Promise.reject(new EntityNotFoundError(entityClass, where));
      }
      return Promise.resolve(value);
    });
  }

  /**
   * Clears all the data from the given table (truncates/drops it).
   *
   * Note: this method uses TRUNCATE and may not work as you expect in transactions on some platforms.
   * @see https://stackoverflow.com/a/5972738/925151
   */
  public async clear<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>
  ): Promise<void> {
    const metadata = this.connection.getMetadata(entityClass);
    const queryRunner = this.queryRunner || this.connection.createQueryRunner();
    try {
      return await queryRunner.clearTable(metadata.tablePath); // await is needed here because we are using finally
    } finally {
      if (!this.queryRunner) await queryRunner.release();
    }
  }

  /**
   * Increments some column by provided value of the entities matched given conditions.
   */
  public async increment<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    conditions: string | ObjectLiteral | Array<ObjectLiteral>,
    propertyPath: string,
    value: number | string
  ): Promise<UpdateResult> {
    const metadata = this.connection.getMetadata(entityClass);
    const column = metadata.findColumnWithPropertyPath(propertyPath);
    if (!column)
      throw new TypeORMError(
        `Column ${propertyPath} was not found in ${metadata.targetName} entity.`
      );

    if (isNaN(Number(value)))
      throw new TypeORMError(`Value "${value}" is not a number.`);

    // convert possible embedded path "social.likes" into object { social: { like: () => value } }
    const values = propertyPath
      .split('.')
      .reduceRight(
        (acc, key) => ({ [key]: acc }),
        (() =>
          this.driver.escape(column.databaseName) +
          ' + ' +
          value) as unknown as Record<string, unknown>
      );

    return this.createQueryBuilder<Entity>(entityClass, 'entity')
      .update(entityClass)
      .set(values as QueryDeepPartialEntity<Entity>)
      .where(conditions)
      .execute();
  }

  /**
   * Decrements some column by provided value of the entities matched given conditions.
   */
  public async decrement<Entity extends ObjectLiteral>(
    entityClass: EntityTarget<Entity>,
    conditions: string | ObjectLiteral | Array<ObjectLiteral>,
    propertyPath: string,
    value: number | string
  ): Promise<UpdateResult> {
    const metadata = this.connection.getMetadata(entityClass);
    const column = metadata.findColumnWithPropertyPath(propertyPath);
    if (!column)
      throw new TypeORMError(
        `Column ${propertyPath} was not found in ${metadata.targetName} entity.`
      );

    if (isNaN(Number(value)))
      throw new TypeORMError(`Value "${value}" is not a number.`);

    // convert possible embedded path "social.likes" into object { social: { like: () => value } }
    const values = propertyPath
      .split('.')
      .reduceRight(
        (acc, key) => ({ [key]: acc }),
        (() =>
          this.connection.driver.escape(column.databaseName) +
          ' + ' +
          value) as unknown as Record<string, unknown>
      );

    return this.createQueryBuilder<Entity>(entityClass, 'entity')
      .update(entityClass)
      .set(values as QueryDeepPartialEntity<Entity>)
      .where(conditions)
      .execute();
  }

  /**
   * Gets repository for the given entity class or name.
   * If single database connection mode is used, then repository is obtained from the
   * repository aggregator, where each repository is individually created for this entity manager.
   * When single database connection is not used, repository is being obtained from the connection.
   */
  public getRepository<Entity>(
    target: EntityTarget<Entity>
  ): Repository<Entity> {
    // find already created repository instance and return it if found
    const repoFromMap = this.repositories.get(
      target as EntityTarget<ObjectLiteral>
    ) as Repository<Entity> | undefined;
    if (repoFromMap) return repoFromMap;

    // if repository was not found then create it, store its instance and return it
    // Note: MongoDB support is not available in this build
    // if (this.driver.options.type === 'mongodb') {
    //   const newRepository = new MongoRepository(target, this, this.queryRunner);
    //   this.repositories.set(target, newRepository);
    //   return newRepository;
    // } else {
    const newRepository = new Repository<Entity>(
      target,
      this,
      this.queryRunner
    );
    this.repositories.set(
      target as EntityTarget<ObjectLiteral>,
      newRepository as Repository<ObjectLiteral>
    );
    return newRepository;
    // }
  }

  /**
   * Gets tree repository for the given entity class or name.
   * If single database connection mode is used, then repository is obtained from the
   * repository aggregator, where each repository is individually created for this entity manager.
   * When single database connection is not used, repository is being obtained from the connection.
   */
  public getTreeRepository<Entity extends ObjectLiteral>(
    target: EntityTarget<Entity>
  ): TreeRepository<Entity> {
    // tree tables aren't supported by some drivers (mongodb)
    if (this.driver.treeSupport === false)
      throw new TreeRepositoryNotSupportedError(this.connection.driver);

    // find already created repository instance and return it if found
    const repository = this.treeRepositories.find(
      (repository) => repository.target === target
    ) as TreeRepository<Entity> | undefined;
    if (repository) return repository;

    // check if repository is real tree repository
    const newRepository = new TreeRepository<Entity>(
      target,
      this,
      this.queryRunner
    );
    this.treeRepositories.push(newRepository as TreeRepository<ObjectLiteral>);
    return newRepository;
  }

  /**
   * Creates a new repository instance out of a given Repository and
   * sets current EntityManager instance to it. Used to work with custom repositories
   * in transactions.
   */
  public withRepository<
    Entity extends ObjectLiteral,
    R extends Repository<ObjectLiteral>,
  >(repository: R & Repository<Entity>): R {
    const repositoryConstructor = repository.constructor as typeof Repository;
    const { target, ...otherRepositoryProperties } = repository;
    return Object.assign(new repositoryConstructor(target, this) as R, {
      ...otherRepositoryProperties,
    });
  }

  /**
   * Releases all resources used by entity manager.
   * This is used when entity manager is created with a single query runner,
   * and this single query runner needs to be released after job with entity manager is done.
   */
  public async release(): Promise<void> {
    if (!this.queryRunner) throw new NoNeedToReleaseEntityManagerError();

    return this.queryRunner.release();
  }
}
