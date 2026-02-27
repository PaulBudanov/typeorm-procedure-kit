import type { DeepPartial } from '../common/DeepPartial.js';
import type { EntityTarget } from '../common/EntityTarget.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { PickKeysByType } from '../common/PickKeysByType.js';
import type { DataSource } from '../data-source/DataSource.js';
import type { FindManyOptions } from '../find-options/FindManyOptions.js';
import type { FindOneOptions } from '../find-options/FindOneOptions.js';
import type { FindOptionsWhere } from '../find-options/FindOptionsWhere.js';
import type { QueryDeepPartialEntity } from '../query-builder/QueryPartialEntity.js';
import type { DeleteResult } from '../query-builder/result/DeleteResult.js';
import type { InsertResult } from '../query-builder/result/InsertResult.js';
import type { UpdateResult } from '../query-builder/result/UpdateResult.js';
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import type { RemoveOptions } from './RemoveOptions.js';
import type { Repository } from './Repository.js';
import type { SaveOptions } from './SaveOptions.js';
import type { UpsertOptions } from './UpsertOptions.js';

/**
 * Base abstract entity for all entities, used in ActiveRecord patterns.
 */
export class BaseEntity {
  // -------------------------------------------------------------------------
  // Private Static Properties
  // -------------------------------------------------------------------------

  /**
   * DataSource used in all static methods of the BaseEntity.
   */
  private static dataSource: DataSource | null = null;

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Checks if entity has an id.
   * If entity composite compose ids, it will check them all.
   */
  public hasId(): boolean {
    const baseEntity = this.constructor as typeof BaseEntity;
    return baseEntity.getRepository().hasId(this as unknown as BaseEntity);
  }

  /**
   * Saves current entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  public save(options?: SaveOptions): Promise<DeepPartial<ObjectLiteral>> {
    const baseEntity = this.constructor as typeof BaseEntity;
    return baseEntity
      .getRepository()
      .save(this as DeepPartial<ObjectLiteral>, options);
  }

  /**
   * Removes current entity from the database.
   */
  public remove(options?: RemoveOptions): Promise<this> {
    const baseEntity = this.constructor as typeof BaseEntity;
    return baseEntity
      .getRepository()
      .remove(
        this as unknown as Array<BaseEntity>,
        options
      ) as unknown as Promise<this>;
  }

  /**
   * Records the delete date of current entity.
   */
  public softRemove(options?: SaveOptions): Promise<this> {
    const baseEntity = this.constructor as typeof BaseEntity;
    return baseEntity
      .getRepository()
      .softRemove(
        this as unknown as Array<DeepPartial<ObjectLiteral>>,
        options
      ) as unknown as Promise<this>;
  }

  /**
   * Recovers a given entity in the database.
   */
  public recover(options?: SaveOptions): Promise<this> {
    const baseEntity = this.constructor as typeof BaseEntity;
    return baseEntity
      .getRepository()
      .recover(
        this as unknown as Array<DeepPartial<ObjectLiteral>>,
        options
      ) as unknown as Promise<this>;
  }

  /**
   * Reloads entity data from the database.
   */
  public async reload(): Promise<void> {
    const baseEntity = this.constructor as typeof BaseEntity;
    const id = baseEntity
      .getRepository()
      .metadata.getEntityIdMap(this as ObjectLiteral);
    if (!id) {
      throw new Error(`Entity doesn't have id-s set, cannot reload entity`);
    }
    const reloadedEntity = await baseEntity
      .getRepository()
      .findOneByOrFail(id as FindOptionsWhere<ObjectLiteral>);

    ObjectUtils.assign(this, reloadedEntity);
  }

  // -------------------------------------------------------------------------
  // Public Static Methods
  // -------------------------------------------------------------------------

  /**
   * Sets DataSource to be used by entity.
   */
  public static useDataSource(dataSource: DataSource | null): void {
    this.dataSource = dataSource;
  }

  /**
   * Gets current entity's Repository.
   */
  public static getRepository<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity
  ): Repository<T> {
    const dataSource = (this as typeof BaseEntity).dataSource;
    if (!dataSource) throw new Error(`DataSource is not set for this entity.`);
    return dataSource.getRepository(this as unknown as EntityTarget<T>);
  }

  /**
   * Returns object that is managed by this repository.
   * If this repository manages entity from schema,
   * then it returns a name of that schema instead.
   */
  public static get target(): EntityTarget<BaseEntity> {
    return this.getRepository().target;
  }

  /**
   * Checks entity has an id.
   * If entity composite compose ids, it will check them all.
   */
  public static hasId(entity: BaseEntity): boolean {
    return this.getRepository().hasId(entity as unknown as BaseEntity);
  }

  /**
   * Gets entity mixed id.
   */
  public static getId<T extends BaseEntity & ObjectLiteral>(
    this: (new () => T) & typeof BaseEntity,
    entity: T
  ): unknown {
    return this.getRepository<T>().getId(entity);
  }

  /**
   * Creates a new query builder that can be used to build a SQL query.
   */
  public static createQueryBuilder<T extends BaseEntity & ObjectLiteral>(
    this: (new () => T) & typeof BaseEntity,
    alias?: string
  ): SelectQueryBuilder<T> {
    return this.getRepository<T>().createQueryBuilder(
      alias
    ) as unknown as SelectQueryBuilder<T>;
  }

  /**
   * Creates a new entity instance.
   */
  public static create<T extends BaseEntity & ObjectLiteral>(
    this: (new () => T) & typeof BaseEntity
  ): T;

  /**
   * Creates a new entity instance and copies all entity properties from this object into a new entity.
   * Note that it copies only properties that present in entity schema.
   */
  public static create<T extends BaseEntity & ObjectLiteral>(
    this: (new () => T) & typeof BaseEntity,
    entityLike: DeepPartial<T>
  ): T;

  /**
   * Creates a new entity instance and copies all entity properties from this object into a new entity.
   * Note that it copies only properties that present in entity schema.
   */
  public static create<T extends BaseEntity & ObjectLiteral>(
    this: (new () => T) & typeof BaseEntity,
    entityOrEntities?: unknown
  ): ObjectLiteral {
    return this.getRepository<T>().create(entityOrEntities as DeepPartial<T>);
  }

  /**
   * Merges multiple entities (or entity-like objects) into a given entity.
   */
  public static merge<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    mergeIntoEntity: T,
    ...entityLikes: Array<DeepPartial<T>>
  ): T {
    return this.getRepository<T>().merge(
      mergeIntoEntity as unknown as T,
      ...(entityLikes as Array<DeepPartial<T>>)
    ) as T;
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
  public static preload<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entityLike: DeepPartial<T>
  ): Promise<T | ObjectLiteral | undefined> {
    const thisRepository = this.getRepository<T>();
    return thisRepository.preload(entityLike as DeepPartial<T>);
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  public static save<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entities: Array<DeepPartial<T>>,
    options?: SaveOptions
  ): Promise<Array<T>>;

  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  public static save<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entity: DeepPartial<T>,
    options?: SaveOptions
  ): Promise<T>;

  /**
   * Saves one or many given entities.
   */
  public static save<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entityOrEntities: DeepPartial<T> | Array<DeepPartial<T>>,
    options?: SaveOptions
  ): Promise<Array<DeepPartial<T>>> {
    return this.getRepository<T>().save(
      entityOrEntities as Array<DeepPartial<T>>,
      options
    );
  }

  /**
   * Removes a given entities from the database.
   */
  public static remove<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entities: Array<T>,
    options?: RemoveOptions
  ): Promise<Array<T>>;

  /**
   * Removes a given entity from the database.
   */
  public static remove<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entity: T,
    options?: RemoveOptions
  ): Promise<T>;

  /**
   * Removes one or many given entities.
   */
  public static remove<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entityOrEntities: T | Array<T>,
    options?: RemoveOptions
  ): Promise<Array<T>> {
    return this.getRepository<T>().remove(
      entityOrEntities as Array<T>,
      options
    );
  }

  /**
   * Records the delete date of all given entities.
   */
  public static softRemove<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entities: Array<T>,
    options?: SaveOptions
  ): Promise<Array<T>>;

  /**
   * Records the delete date of a given entity.
   */
  public static softRemove<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entity: T,
    options?: SaveOptions
  ): Promise<T>;

  /**
   * Records the delete date of one or many given entities.
   */
  public static softRemove<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entityOrEntities: T | Array<T>,
    options?: SaveOptions
  ): Promise<Array<DeepPartial<T>>> {
    return this.getRepository<T>().softRemove(
      entityOrEntities as Array<DeepPartial<T>>,
      options
    );
  }

  /**
   * Inserts a given entity into the database.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient INSERT query.
   * Does not check if entity exist in the database, so query will fail if duplicate entity is being inserted.
   */
  public static insert<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entity: QueryDeepPartialEntity<T> | Array<QueryDeepPartialEntity<T>>
  ): Promise<InsertResult> {
    return this.getRepository<T>().insert(entity);
  }

  /**
   * Updates entity partially. Entity can be found by a given conditions.
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient UPDATE query.
   * Does not check if entity exist in the database.
   */
  public static update<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | FindOptionsWhere<T>,
    partialEntity: QueryDeepPartialEntity<T>
  ): Promise<UpdateResult> {
    return this.getRepository<T>().update(
      criteria as FindOptionsWhere<T>,
      partialEntity
    );
  }

  /**
   * Inserts a given entity into the database, unless a unique constraint conflicts then updates the entity
   * Unlike save method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient INSERT ... ON CONFLICT DO UPDATE/ON DUPLICATE KEY UPDATE query.
   */
  public static upsert<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    entityOrEntities:
      | QueryDeepPartialEntity<T>
      | Array<QueryDeepPartialEntity<T>>,
    conflictPathsOrOptions: Array<string> | UpsertOptions<T>
  ): Promise<InsertResult> {
    return this.getRepository<T>().upsert(
      entityOrEntities,
      conflictPathsOrOptions
    );
  }

  /**
   * Deletes entities by a given criteria.
   * Unlike remove method executes a primitive operation without cascades, relations and other operations included.
   * Executes fast and efficient DELETE query.
   * Does not check if entity exist in the database.
   */
  public static delete<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    criteria:
      | string
      | Array<string>
      | number
      | Array<number>
      | Date
      | Array<Date>
      | FindOptionsWhere<T>
  ): Promise<DeleteResult> {
    return this.getRepository<T>().delete(criteria as FindOptionsWhere<T>);
  }

  /**
   * Checks whether any entity exists that matches the given options.
   */
  public static exists<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    options?: FindManyOptions<T>
  ): Promise<boolean> {
    return this.getRepository<T>().exists(options as FindManyOptions<T>);
  }

  /**
   * Checks whether any entity exists that matches the given conditions.
   */
  public static existsBy<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    where: FindOptionsWhere<T>
  ): Promise<boolean> {
    return this.getRepository<T>().existsBy(where as FindOptionsWhere<T>);
  }

  /**
   * Counts entities that match given options.
   */
  public static count<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    options?: FindManyOptions<T>
  ): Promise<number> {
    return this.getRepository<T>().count(options as FindManyOptions<T>);
  }

  /**
   * Counts entities that match given WHERE conditions.
   */
  public static countBy<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    where: FindOptionsWhere<T>
  ): Promise<number> {
    return this.getRepository<T>().countBy(where as FindOptionsWhere<T>);
  }

  /**
   * Return the SUM of a column
   */
  public static sum<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    columnName: PickKeysByType<T, number>,
    where: FindOptionsWhere<T>
  ): Promise<number | null> {
    return this.getRepository<T>().sum(
      columnName as never,
      where as FindOptionsWhere<T>
    );
  }

  /**
   * Return the AVG of a column
   */
  public static average<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    columnName: PickKeysByType<T, number>,
    where: FindOptionsWhere<T>
  ): Promise<number | null> {
    return this.getRepository<T>().average(
      columnName as never,
      where as FindOptionsWhere<T>
    );
  }

  /**
   * Return the MIN of a column
   */
  public static minimum<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    columnName: PickKeysByType<T, number>,
    where: FindOptionsWhere<T>
  ): Promise<number | null> {
    return this.getRepository<T>().minimum(
      columnName as never,
      where as FindOptionsWhere<T>
    );
  }

  /**
   * Return the MAX of a column
   */
  public static maximum<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    columnName: PickKeysByType<T, number>,
    where: FindOptionsWhere<T>
  ): Promise<number | null> {
    return this.getRepository<T>().maximum(
      columnName as never,
      where as FindOptionsWhere<T>
    );
  }

  /**
   * Finds entities that match given options.
   */
  public static find<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    options?: FindManyOptions<T>
  ): Promise<Array<T>> {
    return this.getRepository<T>().find(
      options as FindManyOptions<T>
    ) as Promise<Array<T>>;
  }

  /**
   * Finds entities that match given WHERE conditions.
   */
  public static findBy<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    where: FindOptionsWhere<T>
  ): Promise<Array<T>> {
    return this.getRepository<T>().findBy(
      where as FindOptionsWhere<T>
    ) as Promise<Array<T>>;
  }

  /**
   * Finds entities that match given find options.
   * Also counts all entities that match given conditions,
   * but ignores pagination settings (from and take options).
   */
  public static findAndCount<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    options?: FindManyOptions<T>
  ): Promise<[Array<T>, number]> {
    return this.getRepository<T>().findAndCount(
      options as FindManyOptions<T>
    ) as Promise<[Array<T>, number]>;
  }

  /**
   * Finds entities that match given WHERE conditions.
   * Also counts all entities that match given conditions,
   * but ignores pagination settings (from and take options).
   */
  public static findAndCountBy<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    where: FindOptionsWhere<T>
  ): Promise<[Array<T>, number]> {
    return this.getRepository<T>().findAndCountBy(
      where as FindOptionsWhere<T>
    ) as Promise<[Array<T>, number]>;
  }

  /**
   * Finds entities by ids.
   * Optionally find options can be applied.
   *
   * @deprecated use `findBy` method instead in conjunction with `In` operator, for example:
   *
   * .findBy({
   *     id: In([1, 2, 3])
   * })
   */
  public static findByIds<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    ids: Array<unknown>
  ): Promise<Array<T>> {
    return this.getRepository<T>().findByIds(ids) as Promise<Array<T>>;
  }

  /**
   * Finds first entity that matches given conditions.
   */
  public static findOne<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    options: FindOneOptions<T>
  ): Promise<T | null> {
    return this.getRepository<T>().findOne(
      options as FindOptionsWhere<ObjectLiteral>
    ) as Promise<T | null>;
  }

  /**
   * Finds first entity that matches given conditions.
   */
  public static findOneBy<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    where: FindOptionsWhere<T>
  ): Promise<T | null> {
    return this.getRepository<T>().findOneBy(
      where as FindOptionsWhere<T>
    ) as Promise<T | null>;
  }

  /**
   * Finds first entity that matches given options.
   *
   * @deprecated use `findOneBy` method instead in conjunction with `In` operator, for example:
   *
   * .findOneBy({
   *     id: 1 // where "id" is your primary column name
   * })
   */
  public static findOneById<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    id: string | number | Date
  ): Promise<T | null> {
    return this.getRepository<T>().findOneById(id) as Promise<T | null>;
  }

  /**
   * Finds first entity that matches given conditions.
   */
  public static findOneOrFail<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    options: FindOneOptions<T>
  ): Promise<T> {
    return this.getRepository<T>().findOneOrFail(
      options as FindOneOptions<T>
    ) as Promise<T>;
  }

  /**
   * Finds first entity that matches given conditions.
   */
  public static findOneByOrFail<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    where: FindOptionsWhere<T>
  ): Promise<T> {
    return this.getRepository<T>().findOneByOrFail(
      where as FindOptionsWhere<T>
    ) as Promise<T>;
  }

  /**
   * Executes a raw SQL query and returns a raw database results.
   * Raw query execution is supported only by relational databases (MongoDB is not supported).
   */
  public static query<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity,
    query: string,
    parameters?: Array<unknown>
  ): Promise<unknown> {
    return this.getRepository<T>().query(query, parameters);
  }

  /**
   * Clears all the data from the given table/collection (truncates/drops it).
   */
  public static clear<T extends BaseEntity>(
    this: (new () => T) & typeof BaseEntity
  ): Promise<void> {
    return this.getRepository<T>().clear();
  }
}
