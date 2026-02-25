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

export interface IBaseConfig {
  master: IDatabaseCredentials;
  poolSize: number;
  slaves?: Array<IDatabaseCredentials>;
  appName?: string;
  callTimeout?: number;
  isNeedRegisterDefaultSerializers?: boolean;
  packagesSettings?: {
    packages: Array<Lowercase<string>>;
    procedureObjectList: Record<string, string>;
    isNeedDynamiclyUpdatePackagesInfo: boolean;
  };
  outKeyTransformCase?: TKeyTransformCase;
}

interface IOracleConfigWithoutLibrary extends IBaseConfig {
  type: 'oracle';
  libraryPath?: undefined;
  cqnPort?: number;
}

interface IOracleConfigWithLibrary extends IBaseConfig {
  type: 'oracle';
  libraryPath: string;
  cqnPort: number;
}

export type TOracleDbConfig =
  | IOracleConfigWithoutLibrary
  | IOracleConfigWithLibrary;

export interface IPostgresDbConfig extends IBaseConfig {
  type: 'postgres';
  parseInt8AsBigInt: boolean;
}

export type TDbConfig = TOracleDbConfig | IPostgresDbConfig;

export interface IEntityOptions {
  isNeedEntitySync: boolean;
  entityPath: Array<string>;
}

export interface IMigrationOptions {
  isNeedMigrationStart: boolean;
  migrationPath: Array<string>;
}

export type TConnectionMode = 'master' | 'slave';

export interface IDatabaseFactory {
  additionalConfig: PostgresConnectionOptions | OracleConnectionOptions;
  databaseAdapter: TAdapterUtilsClassTypes;
}
