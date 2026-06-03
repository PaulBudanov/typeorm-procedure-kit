import type { OracleConnectionOptions } from '../typeorm/driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../typeorm/driver/postgres/PostgresConnectionOptions.js';

import type { TAdapterUtilsClassTypes } from './adapter.types.js';
import type { TKeyTransformCase } from './strategy.types.js';

export interface IDatabaseCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}
interface IPackagesSettingsDefault {
  /**
   * Database package/schema names to inspect for callable procedures.
   * Keep values lowercase because procedure resolution normalizes names.
   */
  packages: Array<Lowercase<string>>;
  /**
   * Procedures that should be loaded from database metadata.
   * Keys are application labels for this configuration object only; `call()`
   * resolves procedure names from the values, using `package.procedure` or
   * `procedure` when only one package is configured.
   */
  procedureObjectList: Record<string, string>;
  /**
   * Trusted developer SQL used to load procedure argument metadata. Do not
   * build this value from user input.
   * The SQL must contain `:PACKAGE_NAME` and return columns compatible with
   * `IProcedureArgumentBase` after snake_case to camelCase conversion:
   * `procedure_name`, `argument_name`, `argument_type`, `order`, and `mode`.
   */
  procedureMetadataSql?: string;
  /**
   * Trusted developer SQL used to subscribe to package metadata change
   * notifications. Do not build this value from user input. PostgreSQL expects
   * a full `LISTEN ...` command. Oracle expects a full CQN `SELECT ...` query.
   */
  metadataNotificationSql?: string;
  /**
   * Enables dynamic package update mode.
   */
  isNeedDynamicallyUpdatePackagesInfo?: boolean;
}

export interface IBaseConfig {
  /**
   * Primary database credentials used for writes and default connections.
   */
  master: IDatabaseCredentials;
  /**
   * Maximum connection pool size passed to the underlying DataSource.
   */
  poolSize: number;
  /**
   * Optional read replicas used by TypeORM replication.
   */
  slaves?: Array<IDatabaseCredentials>;
  /**
   * Application name sent to the database driver when supported.
   */
  appName?: string;
  /**
   * Slow-query threshold passed to TypeORM as `maxQueryExecutionTime`.
   * Queries that exceed this duration are logged but are not cancelled.
   */
  maxQueryExecutionTime?: number;
  /**
   * Global query timeout in milliseconds for library-managed SQL execution.
   * PostgreSQL passes this value to `pg` as `statement_timeout`. Oracle applies
   * it to every acquired physical connection as node-oracledb
   * `connection.callTimeout`, which limits each database round-trip rather than
   * the complete statement duration.
   */
  queryTimeoutMs?: number;
  /**
   * @deprecated Use `maxQueryExecutionTime`. This option is kept as a
   * slow-query threshold alias and does not cancel queries.
   */
  callTimeout?: number;
  /**
   * Registers built-in DATE, TIMESTAMP, and TIMESTAMP_TZ serializers during initialization.
   */
  isNeedRegisterDefaultSerializers?: boolean;
  /**
   * Output key casing for ORM column names and native query result keys.
   * Defaults to `camelCase`.
   */
  outKeyTransformCase?: TKeyTransformCase;
}

interface IOracleBaseConfig extends IBaseConfig {
  type: 'oracle';
  packagesSettings?: IPackagesSettingsDefault;
}

/**
 * Oracle Thin mode.
 *
 * Does not require Oracle Instant Client.
 */
export interface IOracleThinConfig extends IOracleBaseConfig {
  libraryPath?: undefined;
}

/**
 * Oracle Thick mode.
 *
 * Requires the application/client to initialize Oracle Client before DB usage,
 * or to provide a valid library path for library-managed `initOracleClient`.
 *
 * CQN/client notifications are not initialized by this DB config.
 */
export interface IOracleThickConfig extends IOracleBaseConfig {
  libraryPath: string;
}

export type TOracleDbConfig = IOracleThinConfig | IOracleThickConfig;

interface IPostgresDbConfig extends IBaseConfig {
  type: 'postgres';
  /**
   * Passed to the bundled Postgres driver as `parseInt8`.
   * When true, node-postgres parses int8 values as JavaScript numbers instead
   * of strings. Values above Number.MAX_SAFE_INTEGER can lose precision.
   */
  parseInt8AsBigInt: boolean;
  packagesSettings?: IPackagesSettingsDefault & {
    listenEventName?: string;
  };
}

export type TPostgresDbConfig = IPostgresDbConfig;
export type TDbConfig<
  Type = TOracleDbConfig['type'] | TPostgresDbConfig['type'],
> = Type extends TOracleDbConfig['type'] ? TOracleDbConfig : TPostgresDbConfig;

export interface IEntityOptions {
  isNeedEntitySync: boolean;
  entityPath: Array<string>;
}

export interface IMigrationOptions {
  isNeedMigrationStart: boolean;
  migrationPath: Array<string>;
}

export type TConnectionMode = 'master' | 'slave';

export interface IExecutionOptions {
  /**
   * Connection pool mode used to create an EntityManager.
   * Defaults to `master`.
   */
  mode?: TConnectionMode;
  /**
   * Restricted setup commands executed inside the same transaction before the
   * main query. Each item must match the supported safe SET or ALTER SESSION
   * grammar.
   */
  optionsCommands?: Array<string>;
  /**
   * Optional query id used by logs and database error wrapping.
   */
  queryId?: string;
}

export interface IDatabaseFactory {
  additionalConfig: PostgresConnectionOptions | OracleConnectionOptions;
  databaseAdapter: TAdapterUtilsClassTypes;
}
