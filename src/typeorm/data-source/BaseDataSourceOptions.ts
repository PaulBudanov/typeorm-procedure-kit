import type { TDbConfig } from '../../types/config.types.js';
import type { TFunction } from '../../types/utility.types.js';
import { DbQueryResultCache } from '../cache/db-query-result-cache.js';
import type { MixedList } from '../common/MixedList.js';
import { DataSource } from '../data-source/DataSource.js';
import { EntitySchema } from '../entity-schema/EntitySchema.js';
import type { Logger } from '../logger/Logger.js';
import type { LoggerOptions } from '../logger/LoggerOptions.js';
import type { NamingStrategyInterface } from '../naming-strategy/NamingStrategyInterface.js';

/**
 * BaseDataSourceOptions is set of DataSourceOptions shared by all database types.
 */
export interface BaseDataSourceOptions {
  /**
   * Database type. This value is required.
   */
  readonly type: TDbConfig['type'];

  /**
   * Connection name. If connection name is not given then it will be called "default".
   * Different connections must have different names.
   *
   * @deprecated
   */
  readonly name?: string;

  /**
   * Entities to be loaded for this connection.
   * Accepts both entity classes and directories where from entities need to be loaded.
   * Directories support glob patterns.
   */
  readonly entities?: MixedList<TFunction | string | EntitySchema>;

  /**
   * Subscribers to be loaded for this connection.
   * Accepts both subscriber classes and directories where from subscribers need to be loaded.
   * Directories support glob patterns.
   */
  readonly subscribers?: MixedList<TFunction | string>;

  /**
   * Migrations to be loaded for this connection.
   * Accepts both migration classes and glob patterns representing migration files.
   */
  readonly migrations?: MixedList<TFunction | string>;

  /**
   * Migrations table name, in case of different name from "migrations".
   * Accepts single string name.
   */
  readonly migrationsTableName?: string;

  /**
   * Transaction mode for migrations to run in
   */
  readonly migrationsTransactionMode?: 'all' | 'none' | 'each';

  /**
   * Typeorm metadata table name, in case of different name from "typeorm_metadata".
   * Accepts single string name.
   */
  readonly metadataTableName?: string;

  /**
   * Naming strategy to be used to name tables and columns in the database.
   */
  readonly namingStrategy?: NamingStrategyInterface;

  /**
   * Logging options.
   */
  readonly logging?: LoggerOptions;

  /**
   * Logger instance used to log queries and events in the ORM.
   */
  readonly logger?:
    | 'advanced-console'
    | 'simple-console'
    | 'formatted-console'
    | 'file'
    | Logger;

  /**
   * Maximum number of milliseconds query should be executed before logger log a warning.
   */
  readonly maxQueryExecutionTime?: number;

  /**
   * Maximum number of clients the pool should contain.
   */
  readonly poolSize?: number;

  /**
   * Indicates if database schema should be auto created on every application launch.
   * Be careful with this option and don't use this in production - otherwise you can lose production data.
   * This option is useful during debug and development.
   * Alternative to it, you can use CLI and run schema:sync command.
   *
   * Note that for MongoDB database it does not create schema, because MongoDB is schemaless.
   * Instead, it syncs just by creating indices.
   */
  readonly synchronize?: boolean;

  /**
   * Indicates if migrations should be auto run on every application launch.
   * Alternative to it, you can use CLI and run migrations:run command.
   */
  readonly migrationsRun?: boolean;

  /**
   * Drops the schema each time connection is being established.
   * Be careful with this option and don't use this in production - otherwise you'll lose all production data.
   * This option is useful during debug and development.
   */
  readonly dropSchema?: boolean;

  /**
   * Prefix to use on all tables (collections) of this connection in the database.
   */
  readonly entityPrefix?: string;

  /**
   * When creating new Entity instances, skip all constructors when true.
   */
  readonly entitySkipConstructor?: boolean;

  /**
   * Specifies how relations must be loaded - using "joins" or separate queries.
   * If you are loading too much data with nested joins it's better to load relations
   * using separate queries.
   *
   * Default strategy is "join", but this default can be changed here.
   * Also, strategy can be set per-query in FindOptions and QueryBuilder.
   */
  readonly relationLoadStrategy?: 'join' | 'query';

  /**
   * Optionally applied "typename" to the model.
   * If set, then each hydrated model will have this property with the target model / entity name inside.
   *
   * (works like a discriminator property).
   */
  readonly typename?: string;

  /**
   * Holds reference to the baseDirectory where configuration file are expected.
   *
   * @internal
   */
  baseDirectory?: string;

  /**
   * Allows to setup cache options.
   */
  readonly cache?:
    | boolean
    | {
        /**
         * Type of caching.
         *
         * - "database" means cached values will be stored in the separate table in database. This is default value.
         */
        readonly type?: 'database';

        /**
         * Factory function for custom cache providers that implement QueryResultCache.
         */
        readonly provider?: (connection: DataSource) => DbQueryResultCache;

        /**
         * Configurable table name for "database" type cache.
         * Default value is "query-result-cache"
         */
        readonly tableName?: string;

        /**
         * If set to true then queries (using find methods and QueryBuilder's methods) will always be cached.
         */
        readonly alwaysEnabled?: boolean;

        /**
         * Time in milliseconds in which cache will expire.
         * This can be setup per-query.
         * Default value is 1000 which is equivalent to 1 second.
         */
        readonly duration?: number;

        /**
         * Used to specify if cache errors should be ignored, and pass through the call to the Database.
         */
        readonly ignoreErrors?: boolean;
      };

  /**
   * Allows automatic isolation of where clauses
   */
  readonly isolateWhereStatements?: boolean;

  /**
   * Controls how null and undefined values are handled in find operations.
   */
  readonly invalidWhereValuesBehavior?: {
    /**
     * How to handle null values in where conditions.
     * - 'ignore': Skip null properties (default)
     * - 'sql-null': Transform null to SQL NULL
     * - 'throw': Throw an error when null is encountered
     */
    readonly null?: 'ignore' | 'sql-null' | 'throw';

    /**
     * How to handle undefined values in where conditions.
     * - 'ignore': Skip undefined properties (default)
     * - 'throw': Throw an error when undefined is encountered
     */
    readonly undefined?: 'ignore' | 'throw';
  };
}
