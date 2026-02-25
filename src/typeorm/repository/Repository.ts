import type { DeepPartial } from '../common/DeepPartial.js';
import type { EntityTarget } from '../common/EntityTarget.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { PickKeysByType } from '../common/PickKeysByType.js';
import type { EntityManager } from '../entity-manager/EntityManager.js';
import type { FindManyOptions } from '../find-options/FindManyOptions.js';
import type { FindOneOptions } from '../find-options/FindOneOptions.js';
import type { FindOptionsWhere } from '../find-options/FindOptionsWhere.js';
import type { EntityMetadata } from '../metadata/EntityMetadata.js';
import type { QueryDeepPartialEntity } from '../query-builder/QueryPartialEntity.js';
import type { DeleteResult } from '../query-builder/result/DeleteResult.js';
import type { InsertResult } from '../query-builder/result/InsertResult.js';
import type { UpdateResult } from '../query-builder/result/UpdateResult.js';
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
import { buildSqlTag } from '../util/SqlTagUtils.js';

import type { RemoveOptions } from './RemoveOptions.js';
import type { SaveOptions } from './SaveOptions.js';
import type { UpsertOptions } from './UpsertOptions.js';

/**
 * Repository is supposed to work with your entity objects. Find entities, insert, update, delete, etc.
 */
export class Repository<Entity extends ObjectLiteral> {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Entity target that is managed by this repository.
   * If this repository manages entity from schema,
   * then it returns a name of that schema instead.
   */
  public readonly target: EntityTarget<Entity>;

  /**
   * Entity Manager used by this repository.
   */
  public readonly manager: EntityManager;

  /**
   * Query runner provider used for this repository.
   */
  public readonly queryRunner?: QueryRunner;

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Entity metadata of the entity current repository manages.
   */
  public get metadata(): EntityMetadata {
    return this.manager.connection.getMetadata(this.target);
  }

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    target: EntityTarget<Entity>,
    manager: EntityManager,
    queryRunner?: QueryRunner
  ) {
    this.target = target;
    this.manager = manager;
    this.queryRunner = queryRunner;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new query builder that can be used to build a SQL query.
   */
  public createQueryBuilder(
    alias?: string,
    queryRunner?: QueryRunner
  ): SelectQueryBuilder<Entity> {
    return this.manager.createQueryBuilder<Entity>(
      this.metadata.target,
      alias || this.metadata.targetName,
      queryRunner || this.queryRunner
    );
  }

  /**
   * Checks if entity has an id.
   * If entity composite compose ids, it will check them all.
   */
  public hasId(entity: Entity): boolean {
    return this.manager.hasId(this.metadata.target, entity);
  }

  /**
   * Gets entity mixed id.
   */
  public getId(entity: Entity): unknown {
    return this.manager.getId(this.metadata.target, entity);
  }

  /**
   * Creates a new entity instance.
   */
  public create(): Entity;

  /**
   * Creates new entities and copies all entity properties from given objects into their new entities.
   * Note that it copies only properties that are present in entity schema.
   */
  public create(entityLikeArray: Array<DeepPartial<Entity>>): Array<Entity>;

  /**
   * Creates a new entity instance and copies all entity properties from this object into a new entity.
   * Note that it copies only properties that are present in entity schema.
   */
  public create(entityLike: DeepPartial<Entity>): Entity;

  /**
   * Creates a new entity instance or instances.
   * Can copy properties from the given object into new entities.
   */
  public create(
    plainEntityLikeOrPlainEntityLikes?:
      | DeepPartial<Entity>
      | Array<DeepPartial<Entity>>
  ): Entity | Array<Entity> {
    return this.manager.create(
      this.metadata.target,
      plainEntityLikeOrPlainEntityLikes
    );
  }

  /**
   * Merges multiple entities (or entity-like objects) into a given entity.
   */
  public merge(
    mergeIntoEntity: Entity,
    ...entityLikes: Array<DeepPartial<Entity>>
  ): Entity {
    return this.manager.merge(
      this.metadata.target,
      mergeIntoEntity,
      ...entityLikes
    );
  }

  /**
   * Creates a new entity from the given plain javascript object. If entity already exist in the database, then
   * it loads it (and everything related to it), replaces all values with the new ones from the given object
   * and returns this new entity. This new entity is actually a loaded from the db entity with all properties
   * replaced from the new object.
   *
   * Note that given entity-like object must have an entity id / primary key to find entity by.
   * Returns undefined if entity with given id was not found.
   */
  public preload(entityLike: DeepPartial<Entity>): Promise<Entity | undefined> {
    return this.manager.preload(this.metadata.target, entityLike);
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  public save<T extends DeepPartial<Entity>>(
    entities: Array<T>,
    options: SaveOptions & { reload: false }
  ): Promise<Array<T>>;

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  public save<T extends DeepPartial<Entity>>(
    entities: Array<T>,
    options?: SaveOptions
  ): Promise<Array<T & Entity>>;

  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  public save<T extends DeepPartial<Entity>>(
    entity: T,
    options: SaveOptions & { reload: false }
  ): Promise<T>;

  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  public save<T extends DeepPartial<Entity>>(
    entity: T,
    options?: SaveOptions
  ): Promise<T & Entity>;

  /**
   * Saves one or many given entities.
   */
  public save<T extends DeepPartial<Entity>>(
    entityOrEntities: T | Array<T>,
    options?: SaveOptions
  ): Promise<T | Array<T>> {
    return this.manager.save<Entity, T>(
      this.metadata.target,
      entityOrEntities as Array<T>,
      options
    );
  }

  /**
   * Removes a given entities from the database.
   */
  public remove(
    entities: Array<Entity>,
    options?: RemoveOptions
  ): Promise<Array<Entity>>;

  /**
   * Removes a given entity from the database.
   */
  public remove(entity: Entity, options?: RemoveOptions): Promise<Entity>;

  /**
   * Removes one or many given entities.
   */
  public remove(
    entityOrEntities: Entity | Array<Entity>,
    options?: RemoveOptions
  ): Promise<Entity | Array<Entity>> {
    return this.manager.remove(this.metadata.target, entityOrEntities, options);
  }

  /**
   * Records the delete date of all given entities.
   */
  public softRemove<T extends DeepPartial<Entity>>(
    entities: Array<T>,
    options: SaveOptions & { reload: false }
  ): Promise<Array<T>>;

  /**
   * Records the delete date of all given entities.
   */
  public softRemove<T extends DeepPartial<Entity>>(
    entities: Array<T>,
    options?: SaveOptions
  ): Promise<Array<T & Entity>>;

  /**
   * Records the delete date of a given entity.
   */
  public softRemove<T extends DeepPartial<Entity>>(
    entity: T,
    options: SaveOptions & { reload: false }
  ): Promise<T>;

  /**
   * Records the delete date of a given entity.
   */
  public softRemove<T extends DeepPartial<Entity>>(
    entity: T,
    options?: SaveOptions
  ): Promise<T & Entity>;

  /**
   * Records the delete date of one or many given entities.
   */
  public softRemove<T extends DeepPartial<Entity>>(
    entityOrEntities: T | Array<T>,
    options?: SaveOptions
  ): Promise<T | Array<T>> {
    return this.manager.softRemove<Entity, T>(
      this.metadata.target,
      entityOrEntities as Array<T>,
      options
    );
  }

  /**
   * Recovers all given entities in the database.
   */
  public recover<T extends DeepPartial<Entity>>(
    entities: Array<T>,
    options: SaveOptions & { reload: false }
  ): Promise<Array<T>>;

  /**
   * Recovers all given entities in the database.
   */
  public recover<T extends DeepPartial<Entity>>(
    entities: Array<T>,
    options?: SaveOptions
  ): Promise<Array<T & Entity>>;

  /**
   * Recovers a given entity in the database.
   */
  public recover<T extends DeepPartial<Entity>>(
    entity: T,
    options: SaveOptions & { reload: false }
  ): Promise<T>;

  /**
   * Recovers a given entity in the database.
   */
  public recover<T extends DeepPartial<Entity>>(
    entity: T,
    options?: SaveOptions
  ): Promise<T & Entity>;

  /**
   * Recovers one or many given entities.
   */
  public recover<T extends DeepPartial<Entity>>(
    entityOrEntities: T | Array<T>,
    options?: SaveOptions
  ): Promise<T | Array<T>> {
    return this.manager.recover<Entity, T>(
      this.metadata.target,
      entityOrEntities as Array<T>,
      options
    );
  }

  /**
   * Inserts a given entity into the database.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient INSERT query.
   * Does not check if entity exist in the database, so query will fail if duplicate entity is being inserted.
   */
  public insert(
    entity:
      | QueryDeepPartialEntity<Entity>
      | Array<QueryDeepPartialEntity<Entity>>
  ): Promise<InsertResult> {
    return this.manager.insert(this.metadata.target, entity);
  }

  /**
   * Updates entity partially. Entity can be found by a given conditions.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient UPDATE query.
   * Does not check if entity exist in the database.
   */
  public update(
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | FindOptionsWhere<Entity>
      | Array<FindOptionsWhere<Entity>>,
    partialEntity: QueryDeepPartialEntity<Entity>
  ): Promise<UpdateResult> {
    return this.manager.update(this.metadata.target, criteria, partialEntity);
  }

  /**
   * Updates all entities of target type, setting fields from supplied partial entity.
   * This is a primitive operation without cascades, relations or other operations included.
   * Executes fast and efficient UPDATE query without WHERE clause.
   *
   * WARNING! This method updates ALL rows in the target table.
   */
  public updateAll(
    partialEntity: QueryDeepPartialEntity<Entity>
  ): Promise<UpdateResult> {
    return this.manager.updateAll(this.metadata.target, partialEntity);
  }

  /**
   * Inserts a given entity into the database, unless a unique constraint conflicts then updates the entity
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient INSERT ... ON CONFLICT DO UPDATE/ON DUPLICATE KEY UPDATE query.
   */
  public upsert(
    entityOrEntities:
      | QueryDeepPartialEntity<Entity>
      | Array<QueryDeepPartialEntity<Entity>>,
    conflictPathsOrOptions: Array<string> | UpsertOptions<Entity>
  ): Promise<InsertResult> {
    return this.manager.upsert(
      this.metadata.target,
      entityOrEntities,
      conflictPathsOrOptions
    );
  }

  /**
   * Deletes entities by a given criteria.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient DELETE query.
   * Does not check if entity exist in the database.
   */
  public delete(
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | FindOptionsWhere<Entity>
      | Array<FindOptionsWhere<Entity>>
  ): Promise<DeleteResult> {
    return this.manager.delete(this.metadata.target, criteria);
  }

  /**
   * Deletes all entities of target type.
   * This is a primitive operation without cascades, relations or other operations included.
   * Executes fast and efficient DELETE query without WHERE clause.
   *
   * WARNING! This method deletes ALL rows in the target table.
   */
  public deleteAll(): Promise<DeleteResult> {
    return this.manager.deleteAll(this.metadata.target);
  }

  /**
   * Records the delete date of entities by a given criteria.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient UPDATE query.
   * Does not check if entity exist in the database.
   */
  public softDelete(
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | FindOptionsWhere<Entity>
      | Array<FindOptionsWhere<Entity>>
  ): Promise<UpdateResult> {
    return this.manager.softDelete(
      this.metadata.target as EntityTarget<ObjectLiteral>,
      criteria
    );
  }

  /**
   * Restores entities by a given criteria.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient UPDATE query.
   * Does not check if entity exist in the database.
   */
  public restore(
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | FindOptionsWhere<Entity>
      | Array<FindOptionsWhere<Entity>>
  ): Promise<UpdateResult> {
    return this.manager.restore(
      this.metadata.target as EntityTarget<ObjectLiteral>,
      criteria as unknown
    );
  }

  /**
   * Checks whether any entity exists that matches the given options.
   *
   * @deprecated use `exists` method instead, for example:
   *
   * .exists()
   */
  public exist(options?: FindManyOptions<Entity>): Promise<boolean> {
    return this.manager.exists(this.metadata.target, options);
  }

  /**
   * Checks whether any entity exists that matches the given options.
   */
  public exists(options?: FindManyOptions<Entity>): Promise<boolean> {
    return this.manager.exists(this.metadata.target, options);
  }

  /**
   * Checks whether any entity exists that matches the given conditions.
   */
  public existsBy(
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<boolean> {
    return this.manager.existsBy(this.metadata.target, where);
  }

  /**
   * Counts entities that match given options.
   * Useful for pagination.
   */
  public count(options?: FindManyOptions<Entity>): Promise<number> {
    return this.manager.count(this.metadata.target, options);
  }

  /**
   * Counts entities that match given conditions.
   * Useful for pagination.
   */
  public countBy(
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number> {
    return this.manager.countBy(this.metadata.target, where);
  }

  /**
   * Return the SUM of a column
   */
  public sum(
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.manager.sum(this.metadata.target, columnName, where);
  }

  /**
   * Return the AVG of a column
   */
  public average(
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.manager.average(this.metadata.target, columnName, where);
  }

  /**
   * Return the MIN of a column
   */
  public minimum(
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.manager.minimum(this.metadata.target, columnName, where);
  }

  /**
   * Return the MAX of a column
   */
  public maximum(
    columnName: PickKeysByType<Entity, number>,
    where?: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<number | null> {
    return this.manager.maximum(this.metadata.target, columnName, where);
  }

  /**
   * Finds entities that match given find options.
   */
  public async find(options?: FindManyOptions<Entity>): Promise<Array<Entity>> {
    return this.manager.find(this.metadata.target, options);
  }

  /**
   * Finds entities that match given find options.
   */
  public async findBy(
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<Array<Entity>> {
    return this.manager.findBy(this.metadata.target, where);
  }

  /**
   * Finds entities that match given find options.
   * Also counts all entities that match given conditions,
   * but ignores pagination settings (from and take options).
   */
  public findAndCount(
    options?: FindManyOptions<Entity>
  ): Promise<[Array<Entity>, number]> {
    return this.manager.findAndCount(this.metadata.target, options);
  }

  /**
   * Finds entities that match given WHERE conditions.
   * Also counts all entities that match given conditions,
   * but ignores pagination settings (from and take options).
   */
  public findAndCountBy(
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<[Array<Entity>, number]> {
    return this.manager.findAndCountBy(this.metadata.target, where);
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
  public async findByIds(ids: Array<unknown>): Promise<Array<Entity>> {
    return this.manager.findByIds(this.metadata.target, ids);
  }

  /**
   * Finds first entity by a given find options.
   * If entity was not found in the database - returns null.
   */
  public async findOne(
    options: FindOneOptions<Entity>
  ): Promise<Entity | null> {
    return this.manager.findOne(this.metadata.target, options);
  }

  /**
   * Finds first entity that matches given where condition.
   * If entity was not found in the database - returns null.
   */
  public async findOneBy(
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<Entity | null> {
    return this.manager.findOneBy(this.metadata.target, where);
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
  public async findOneById(id: number | string | Date): Promise<Entity | null> {
    return this.manager.findOneById(this.metadata.target, id);
  }

  /**
   * Finds first entity by a given find options.
   * If entity was not found in the database - rejects with error.
   */
  public async findOneOrFail(options: FindOneOptions<Entity>): Promise<Entity> {
    return this.manager.findOneOrFail(this.metadata.target, options);
  }

  /**
   * Finds first entity that matches given where condition.
   * If entity was not found in the database - rejects with error.
   */
  public async findOneByOrFail(
    where: FindOptionsWhere<Entity> | Array<FindOptionsWhere<Entity>>
  ): Promise<Entity> {
    return this.manager.findOneByOrFail(this.metadata.target, where);
  }

  /**
   * Executes a raw SQL query and returns a raw database results.
   * Raw query execution is supported only by relational databases (MongoDB is not supported).
   *
   * @see [Official docs](https://typeorm.io/repository-api) for examples.
   */
  public query<T = unknown>(
    query: string,
    parameters?: Array<unknown>
  ): Promise<T> {
    return this.manager.query(query, parameters);
  }

  /**
   * Tagged template function that executes raw SQL query and returns raw database results.
   * Template expressions are automatically transformed into database parameters.
   * Raw query execution is supported only by relational databases (MongoDB is not supported).
   * Note: Don't call this as a regular function, it is meant to be used with backticks to tag a template literal.
   * Example: repository.sql`SELECT * FROM table_name WHERE id = ${id}`
   */
  public async sql<T = unknown>(
    strings: TemplateStringsArray,
    ...values: Array<unknown>
  ): Promise<T> {
    const { query, parameters } = buildSqlTag({
      driver: this.manager.connection.driver,
      strings: strings,
      expressions: values,
    });

    return await this.query(query, parameters);
  }

  /**
   * Clears all the data from the given table/collection (truncates/drops it).
   *
   * Note: this method uses TRUNCATE and may not work as you expect in transactions on some platforms.
   * @see https://stackoverflow.com/a/5972738/925151
   */
  public clear(): Promise<void> {
    return this.manager.clear(this.metadata.target);
  }

  /**
   * Increments some column by provided value of the entities matched given conditions.
   */
  public increment(
    conditions: FindOptionsWhere<Entity>,
    propertyPath: string,
    value: number | string
  ): Promise<UpdateResult> {
    return this.manager.increment(
      this.metadata.target,
      conditions,
      propertyPath,
      value
    );
  }

  /**
   * Decrements some column by provided value of the entities matched given conditions.
   */
  public decrement(
    conditions: FindOptionsWhere<Entity>,
    propertyPath: string,
    value: number | string
  ): Promise<UpdateResult> {
    return this.manager.decrement(
      this.metadata.target,
      conditions,
      propertyPath,
      value
    );
  }

  /**
   * Extends repository with provided functions.
   */
  public extend<CustomRepository>(
    customs: CustomRepository & ThisType<this & CustomRepository>
  ): this & CustomRepository {
    const thisRepo = this.constructor as new (
      target: EntityTarget<Entity>,
      manager: EntityManager,
      queryRunner?: QueryRunner
    ) => Repository<ObjectLiteral>;
    const { target, manager, queryRunner } = this;
    const ChildClass = class extends thisRepo {
      public constructor(
        target: EntityTarget<Entity>,
        manager: EntityManager,
        queryRunner?: QueryRunner
      ) {
        super(target, manager, queryRunner);
      }
    };
    for (const custom in customs)
      (ChildClass.prototype as unknown as Record<string, unknown>)[
        custom as keyof typeof Repository
      ] = customs[custom];
    return new ChildClass(target, manager, queryRunner) as this &
      CustomRepository;
  }
}
