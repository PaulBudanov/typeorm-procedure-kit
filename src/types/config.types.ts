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
   * Enables dynamic package update mode. In PostgreSQL configs this also
   * requires `listenEventName` so package-change notifications can use a
   * custom channel.
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
   * Slow-query threshold passed as maxQueryExecutionTime.
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

interface IOracleConfigWithoutLibrary extends IBaseConfig {
  type: 'oracle';
  libraryPath?: undefined;
  cqnPort?: number;
  isNeedClientNotificationInit?: boolean;
  packagesSettings?: IPackagesSettingsDefault;
}

interface IOracleConfigWithLibrary extends Omit<
  IOracleConfigWithoutLibrary,
  'libraryPath'
> {
  libraryPath: string;
}

export type TOracleDbConfig =
  | IOracleConfigWithoutLibrary
  | IOracleConfigWithLibrary;

interface IPostgresDbConfigWithPackagesEvent extends IBaseConfig {
  type: 'postgres';
  /**
   * Passed to the bundled Postgres driver as `parseInt8`.
   * When true, node-postgres parses int8 values as JavaScript numbers instead
   * of strings. Values above Number.MAX_SAFE_INTEGER can lose precision.
   */
  parseInt8AsBigInt: boolean;
  packagesSettings?: IPackagesSettingsDefault & {
    listenEventName: string;
    isNeedDynamicallyUpdatePackagesInfo: true;
  };
}

interface IPostgresDbConfigWithoutPackagesEvent extends Omit<
  IPostgresDbConfigWithPackagesEvent,
  'packagesSettings'
> {
  packagesSettings?: IPackagesSettingsDefault & {
    listenEventName?: string;
    isNeedDynamicallyUpdatePackagesInfo?: false;
  };
}

export type TPostgresDbConfig =
  | IPostgresDbConfigWithPackagesEvent
  | IPostgresDbConfigWithoutPackagesEvent;
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
   * SQL commands executed inside the same transaction before the main query.
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
