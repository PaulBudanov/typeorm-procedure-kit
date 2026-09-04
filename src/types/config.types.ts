import type {
  IOracleBaseConfig,
  IPostgresDbConfig,
} from '../interfaces/config.interfaces.js';

export type {
  IBaseConfig,
  IDatabaseCredentials,
  IDatabaseFactory,
  IEntityOptions,
  IExecutionOptions,
  IMigrationOptions,
  IResourceLimits,
} from '../interfaces/config.interfaces.js';

export type TOracleDbConfig = IOracleBaseConfig;

export type TPostgresDbConfig = IPostgresDbConfig;

export type TDbConfig<
  Type = TOracleDbConfig['type'] | TPostgresDbConfig['type'],
> = Type extends TOracleDbConfig['type'] ? TOracleDbConfig : TPostgresDbConfig;

export type TConnectionMode = 'master' | 'slave';
