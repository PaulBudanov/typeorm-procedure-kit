import type { TFunction } from '../../types/utility.types.js';
import { ServerError } from '../../utils/server-error.js';
import type { QueryResultCache } from '../cache/cache.types.js';
import { DbQueryResultCacheFactory } from '../cache/db-query-result-cache-factory.js';
import type { EntityTarget } from '../common/EntityTarget.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { ConnectionMetadataBuilder } from '../connection/ConnectionMetadataBuilder.js';
import type { Driver } from '../driver/Driver.js';
import { DriverFactory } from '../driver/DriverFactory.js';
import { DriverUtils } from '../driver/DriverUtils.js';
import type { IsolationLevel } from '../driver/types/IsolationLevel.js';
import { EntityManager } from '../entity-manager/EntityManager.js';
import { EntityManagerFactory } from '../entity-manager/EntityManagerFactory.js';
import type { EntitySchema } from '../entity-schema/EntitySchema.js';
import { CannotConnectAlreadyConnectedError } from '../error/CannotConnectAlreadyConnectedError.js';
import { CannotExecuteNotConnectedError } from '../error/CannotExecuteNotConnectedError.js';
import { EntityMetadataNotFoundError } from '../error/EntityMetadataNotFoundError.js';
import { QueryRunnerProviderAlreadyReleasedError } from '../error/QueryRunnerProviderAlreadyReleasedError.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { Logger } from '../logger/Logger.js';
import { LoggerFactory } from '../logger/LoggerFactory.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { EntityMetadataValidator } from '../metadata-builder/EntityMetadataValidator.js';
import { Migration } from '../migration/Migration.js';
import { MigrationExecutor } from '../migration/MigrationExecutor.js';
import type { MigrationInterface } from '../migration/MigrationInterface.js';
import { DefaultNamingStrategy } from '../naming-strategy/DefaultNamingStrategy.js';
import type { NamingStrategyInterface } from '../naming-strategy/NamingStrategyInterface.js';
import { registerQueryBuilders } from '../query-builder/index.js';
import { RelationIdLoader } from '../query-builder/RelationIdLoader.js';
import { RelationLoader } from '../query-builder/RelationLoader.js';
import { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
import { Repository } from '../repository/Repository.js';
import { TreeRepository } from '../repository/TreeRepository.js';
import type { EntitySubscriberInterface } from '../subscriber/EntitySubscriberInterface.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { ObjectUtils } from '../util/ObjectUtils.js';
import { buildSqlTag } from '../util/SqlTagUtils.js';

import type { DataSourceOptions } from './DataSourceOptions.js';

registerQueryBuilders();

/**
 * DataSource is a pre-defined connection configuration to a specific database.
 * You can have multiple data sources connected (with multiple connections in it),
 * connected to multiple databases in your application.
 *
 * Before, it was called `Connection`, but now `Connection` is deprecated
 * because `Connection` isn't the best name for what it's actually is.
 */
export class DataSource {
  public readonly '@instanceof' = Symbol.for('DataSource');

  // -------------------------------------------------------------------------
  // Public Readonly Properties
  // -------------------------------------------------------------------------

  /**
   * Connection options.
   */
  public readonly options: DataSourceOptions;

  /**
   * Indicates if DataSource is initialized or not.
   */
  public readonly isInitialized: boolean;

  /**
   * Database driver used by this connection.
   */
  public driver: Driver;

  /**
   * EntityManager of this connection.
   */
  public readonly manager: EntityManager;

  /**
   * Naming strategy used in the connection.
   */
  public namingStrategy: NamingStrategyInterface;

  /**
   * Name for the metadata table
   */
  public readonly metadataTableName: string;

  /**
   * Logger used to log orm events.
   */
  public logger: Logger;

  /**
   * Migration instances that are registered for this connection.
   */
  public readonly migrations: Array<MigrationInterface> = [];

  /**
   * Entity subscriber instances that are registered for this connection.
   */
  public readonly subscribers: Array<EntitySubscriberInterface<unknown>> = [];

  /**
   * All entity metadatas that are registered for this connection.
   */
  public readonly entityMetadatas: Array<EntityMetadata> = [];

  /**
   * All entity metadatas that are registered for this connection.
   * This is a copy of #.entityMetadatas property -> used for more performant searches.
   */
  public readonly entityMetadatasMap = new Map<
    EntityTarget<unknown>,
    EntityMetadata
  >();

  /**
   * Used to work with query result cache.
   */
  public queryResultCache?: QueryResultCache;

  public isQuotingDisabled?: boolean;

  /**
   * Used to load relations and work with lazy relations.
   */
  public readonly relationLoader: RelationLoader;

  public readonly relationIdLoader: RelationIdLoader;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options: DataSourceOptions) {
    registerQueryBuilders();
    this.options = options;
    this.logger = new LoggerFactory().create(
      this.options.logger,
      this.options.logging
    );
    this.driver = new DriverFactory().create(this);
    this.manager = this.createEntityManager();
    this.namingStrategy = options.namingStrategy ?? new DefaultNamingStrategy();
    this.metadataTableName = options.metadataTableName ?? 'typeorm_metadata';
    this.queryResultCache = options.cache
      ? new DbQueryResultCacheFactory(this).create()
      : undefined;
    this.relationLoader = new RelationLoader(this);
    this.relationIdLoader = new RelationIdLoader(this);
    this.isInitialized = false;
    this.isQuotingDisabled = options.isQuotingDisabled;
  }

  // -------------------------------------------------------------------------
  // Public Accessors
  // -------------------------------------------------------------------------

  /**
     Indicates if DataSource is initialized or not.
     *
     * @deprecated use .isInitialized instead
     */
  public get isConnected(): boolean {
    return this.isInitialized;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------
  /**
   * Updates current connection options with provided options.
   */
  public setOptions(options: Partial<DataSourceOptions>): this {
    Object.assign(this.options, options);

    if (options.logger || options.logging) {
      this.logger = new LoggerFactory().create(
        options.logger || this.options.logger,
        options.logging || this.options.logging
      );
    }

    if (options.namingStrategy) {
      this.namingStrategy = options.namingStrategy;
    }

    if (options.cache) {
      this.queryResultCache = new DbQueryResultCacheFactory(this).create();
    }

    // todo: we must update the database in the driver as well, if it was set by setOptions method
    //  in the future we need to refactor the code and remove "database" from the driver, and instead
    //  use database (and options) from a single place - data source.
    if (options.database) {
      this.driver.database = DriverUtils.buildDriverOptions(
        this.options
      ).database;
    }

    // todo: need to take a look if we need to update schema and other "poor" properties

    return this;
  }

  /**
   * Performs connection to the database.
   * This method should be called once on application bootstrap.
   * This method not necessarily creates database connection (depend on database type),
   * but it also can setup a connection pool with database to use.
   */
  public async initialize(): Promise<this> {
    if (this.isInitialized)
      throw new CannotConnectAlreadyConnectedError(DataSource.name);

    // connect to the database via its driver
    await this.driver.connect();

    // set connected status for the current connection
    ObjectUtils.assign(this, { isInitialized: true });

    try {
      // build all metadatas registered in the current connection
      await this.buildMetadatas();

      await this.driver.afterConnect();

      // if option is set - drop schema once connection is done
      if (this.options.dropSchema) await this.dropDatabase();

      // if option is set - automatically synchronize a schema
      if (this.options.migrationsRun)
        await this.runMigrations({
          transaction: this.options.migrationsTransactionMode,
        });

      // if option is set - automatically synchronize a schema
      if (this.options.synchronize) await this.synchronize();
    } catch (error) {
      // if for some reason build metadata fail (for example validation error during entity metadata check)
      // connection needs to be closed
      await this.destroy();
      throw error;
    }

    return this;
  }

  /**
   * Performs connection to the database.
   * This method should be called once on application bootstrap.
   * This method not necessarily creates database connection (depend on database type),
   * but it also can setup a connection pool with database to use.
   *
   * @deprecated use .initialize method instead
   */
  public async connect(): Promise<this> {
    return this.initialize();
  }

  /**
   * Closes connection with the database.
   * Once connection is closed, you cannot use repositories or perform any operations except opening connection again.
   */
  public async destroy(): Promise<void> {
    if (!this.isInitialized)
      throw new CannotExecuteNotConnectedError(DataSource.name);

    await this.driver.disconnect();

    ObjectUtils.assign(this, { isInitialized: false });
  }

  /**
   * Closes connection with the database.
   * Once connection is closed, you cannot use repositories or perform any operations except opening connection again.
   *
   * @deprecated use .destroy method instead
   */
  public async close(): Promise<void> {
    return this.destroy();
  }

  /**
   * Creates database schema for all entities registered in this connection.
   * Can be used only after connection to the database is established.
   *
   * @param dropBeforeSync If set to true then it drops the database with all its tables and data
   */
  public async synchronize(dropBeforeSync = false): Promise<void> {
    if (!this.isInitialized)
      throw new CannotExecuteNotConnectedError(DataSource.name);

    if (dropBeforeSync) await this.dropDatabase();

    const schemaBuilder = this.driver.createSchemaBuilder();
    await schemaBuilder.build();
  }

  /**
   * Drops the database and all its data.
   * Be careful with this method on production since this method will erase all your database tables and their data.
   * Can be used only after connection to the database is established.
   */
  // TODO rename
  public async dropDatabase(): Promise<void> {
    throw new ServerError(
      'Method not implemented.IT`S NOT SAFE TO DROP DATABASE.'
    );
  }

  /**
   * Runs all pending migrations.
   * Can be used only after connection to the database is established.
   */
  public async runMigrations(options?: {
    transaction?: 'all' | 'none' | 'each';
    fake?: boolean;
  }): Promise<Array<Migration>> {
    if (!this.isInitialized)
      throw new CannotExecuteNotConnectedError(DataSource.name);

    const migrationExecutor = new MigrationExecutor(this);
    migrationExecutor.transaction =
      options?.transaction || this.options?.migrationsTransactionMode || 'all';
    migrationExecutor.fake = (options && options.fake) || false;

    const successMigrations =
      await migrationExecutor.executePendingMigrations();
    return successMigrations;
  }

  /**
   * Reverts last executed migration.
   * Can be used only after connection to the database is established.
   */
  public async undoLastMigration(options?: {
    transaction?: 'all' | 'none' | 'each';
    fake?: boolean;
  }): Promise<void> {
    if (!this.isInitialized)
      throw new CannotExecuteNotConnectedError(DataSource.name);

    const migrationExecutor = new MigrationExecutor(this);
    migrationExecutor.transaction = (options && options.transaction) || 'all';
    migrationExecutor.fake = (options && options.fake) || false;

    await migrationExecutor.undoLastMigration();
  }

  /**
   * Lists all migrations and whether they have been run.
   * Returns true if there are pending migrations
   */
  public async showMigrations(): Promise<boolean> {
    if (!this.isInitialized) {
      throw new CannotExecuteNotConnectedError(DataSource.name);
    }
    const migrationExecutor = new MigrationExecutor(this);
    return await migrationExecutor.showMigrations();
  }

  /**
   * Checks if entity metadata exist for the given entity class, target name or table name.
   */
  public hasMetadata(target: EntityTarget<ObjectLiteral>): boolean {
    return !!this.findMetadata(target);
  }

  /**
   * Gets entity metadata for the given entity class or schema name.
   */
  public getMetadata(target: EntityTarget<ObjectLiteral>): EntityMetadata {
    const metadata = this.findMetadata(target);
    if (!metadata) throw new EntityMetadataNotFoundError(target);

    return metadata;
  }

  /**
   * Gets repository for the given entity.
   */
  public getRepository<Entity = unknown>(
    target: EntityTarget<Entity>
  ): Repository<Entity> {
    return this.manager.getRepository(target);
  }

  /**
   * Gets tree repository for the given entity class or name.
   * Only tree-type entities can have a TreeRepository, like ones decorated with @Tree decorator.
   */
  public getTreeRepository<Entity extends ObjectLiteral>(
    target: EntityTarget<Entity>
  ): TreeRepository<Entity> {
    return this.manager.getTreeRepository(target);
  }

  /**
   * Wraps given function execution (and all operations made there) into a transaction.
   * All database operations must be executed using provided entity manager.
   */
  public async transaction<T>(
    runInTransaction: (entityManager: EntityManager) => Promise<T>
  ): Promise<T>;
  public async transaction<T>(
    isolationLevel: IsolationLevel,
    runInTransaction: (entityManager: EntityManager) => Promise<T>
  ): Promise<T>;
  public async transaction<T>(
    isolationOrRunInTransaction:
      | IsolationLevel
      | ((entityManager: EntityManager) => Promise<T>),
    runInTransactionParam?: (entityManager: EntityManager) => Promise<T>
  ): Promise<unknown> {
    return this.manager.transaction(
      isolationOrRunInTransaction,
      runInTransactionParam
    );
  }

  /**
   * Executes raw SQL query and returns raw database results.
   *
   * @see [Official docs](https://typeorm.io/data-source-api) for examples.
   */
  public async query<T = unknown>(
    query: string,
    parameters?: Array<unknown>,
    queryRunner?: QueryRunner
  ): Promise<T> {
    if (queryRunner && queryRunner.isReleased)
      throw new QueryRunnerProviderAlreadyReleasedError();

    const usedQueryRunner = queryRunner || this.createQueryRunner();

    try {
      return await usedQueryRunner.query(query, parameters); // await is needed here because we are using finally
    } finally {
      if (!queryRunner) await usedQueryRunner.release();
    }
  }

  /**
   * Tagged template function that executes raw SQL query and returns raw database results.
   * Template expressions are automatically transformed into database parameters.
   * Raw query execution is supported only by relational databases (MongoDB is not supported).
   * Note: Don't call this as a regular function, it is meant to be used with backticks to tag a template literal.
   * Example: dataSource.sql`SELECT * FROM table_name WHERE id = ${id}`
   */
  public async sql<T = unknown>(
    strings: TemplateStringsArray,
    ...values: Array<unknown>
  ): Promise<T> {
    const { query, parameters } = buildSqlTag({
      driver: this.driver,
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
    entityOrRunner?: EntityTarget<Entity> | QueryRunner,
    alias?: string,
    queryRunner?: QueryRunner
  ): SelectQueryBuilder<Entity> {
    if (alias) {
      alias = DriverUtils.buildAlias(this.driver, undefined, alias);
      const metadata = this.getMetadata(entityOrRunner as EntityTarget<Entity>);
      return new SelectQueryBuilder(this, queryRunner)
        .select(alias)
        .from(metadata.target, alias);
    } else {
      return new SelectQueryBuilder(
        this,
        entityOrRunner as QueryRunner | undefined
      );
    }
  }

  /**
   * Creates a query runner used for perform queries on a single database connection.
   * Using query runners you can control your queries to execute using single database connection and
   * manually control your database transaction.
   *
   * Mode is used in replication mode and indicates whatever you want to connect
   * to master database or any of slave databases.
   * If you perform writes you must use master database,
   * if you perform reads you can use slave databases.
   */
  public createQueryRunner(mode: 'master' | 'slave' = 'master'): QueryRunner {
    const queryRunner = this.driver.createQueryRunner(mode);
    const manager = this.createEntityManager(queryRunner);
    Object.assign(queryRunner, { manager: manager });
    return queryRunner;
  }

  /**
   * Gets entity metadata of the junction table (many-to-many table).
   */
  public getManyToManyMetadata(
    entityTarget: EntityTarget<ObjectLiteral>,
    relationPropertyPath: string
  ): EntityMetadata | undefined {
    const relationMetadata =
      this.getMetadata(entityTarget).findRelationWithPropertyPath(
        relationPropertyPath
      );
    if (!relationMetadata)
      throw new TypeORMError(
        `Relation "${relationPropertyPath}" was not found in ${entityTarget} entity.`
      );
    if (!relationMetadata.isManyToMany)
      throw new TypeORMError(
        `Relation "${entityTarget}#${relationPropertyPath}" does not have a many-to-many relationship.` +
          `You can use this method only on many-to-many relations.`
      );

    return relationMetadata.junctionEntityMetadata;
  }

  /**
   * Creates an Entity Manager for the current connection with the help of the EntityManagerFactory.
   */
  public createEntityManager(queryRunner?: QueryRunner): EntityManager {
    return EntityManagerFactory.create(this, queryRunner);
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Finds exist entity metadata by the given entity class, target name or table name.
   */
  protected findMetadata(
    target: EntityTarget<unknown>
  ): EntityMetadata | undefined {
    const metadataFromMap = this.entityMetadatasMap.get(target);
    if (metadataFromMap) return metadataFromMap;

    for (const [_, metadata] of this.entityMetadatasMap) {
      if (
        InstanceChecker.isEntitySchema(target) &&
        metadata.name === (target as EntitySchema).options.name
      ) {
        return metadata;
      }
      if (typeof target === 'string') {
        if (target.indexOf('.') !== -1) {
          if (metadata.tablePath === target) {
            return metadata;
          }
        } else {
          if (metadata.name === target || metadata.tableName === target) {
            return metadata;
          }
        }
      }
      if (
        ObjectUtils.isObjectWithName(target) &&
        typeof target.name === 'string'
      ) {
        if (target.name.indexOf('.') !== -1) {
          if (metadata.tablePath === target.name) {
            return metadata;
          }
        } else {
          if (
            metadata.name === target.name ||
            metadata.tableName === target.name
          ) {
            return metadata;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Builds metadatas for all registered classes inside this connection.
   */
  protected async buildMetadatas(): Promise<void> {
    const connectionMetadataBuilder = new ConnectionMetadataBuilder(this);
    const entityMetadataValidator = new EntityMetadataValidator();

    // create subscribers instances if they are not disallowed from high-level (for example they can disallowed from migrations run process)
    const flattenedSubscribers = ObjectUtils.mixedListToArray<
      string | TFunction
    >(this.options.subscribers ?? []);
    const subscribers =
      await connectionMetadataBuilder.buildSubscribers(flattenedSubscribers);
    ObjectUtils.assign(this, { subscribers: subscribers });

    // build entity metadatas
    const flattenedEntities = ObjectUtils.mixedListToArray<
      string | TFunction | EntitySchema<unknown>
    >(this.options.entities ?? []);
    const entityMetadatas =
      await connectionMetadataBuilder.buildEntityMetadatas(flattenedEntities);
    ObjectUtils.assign(this, {
      entityMetadatas: entityMetadatas,
      entityMetadatasMap: new Map(
        entityMetadatas.map((metadata) => [metadata.target, metadata])
      ),
    });

    // create migration instances
    const flattenedMigrations = ObjectUtils.mixedListToArray<
      TFunction | string
    >(this.options.migrations ?? []);
    const migrations =
      await connectionMetadataBuilder.buildMigrations(flattenedMigrations);
    ObjectUtils.assign(this, { migrations: migrations });

    // validate all created entity metadatas to make sure user created entities are valid and correct
    entityMetadataValidator.validateMany(
      this.entityMetadatas.filter((metadata) => metadata.tableType !== 'view'),
      this.driver
    );

    // set current data source to the entities
    for (const entityMetadata of entityMetadatas) {
      if (InstanceChecker.isBaseEntityConstructor(entityMetadata.target)) {
        entityMetadata.target.useDataSource(this);
      }
    }
  }

  /**
   * Get the replication mode SELECT queries should use for this datasource by default
   */
  public defaultReplicationModeForReads(): 'master' | 'slave' {
    if (
      'replication' in this.driver.options &&
      this.driver.options.replication
    ) {
      const value = (
        this.driver.options.replication as {
          defaultMode?: 'master' | 'slave';
        }
      ).defaultMode;
      if (value) {
        return value;
      }
    }
    return 'slave';
  }
}
