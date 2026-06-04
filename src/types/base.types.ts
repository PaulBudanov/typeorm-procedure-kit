import type {
  IEntityOptions,
  IMigrationOptions,
  TDbConfig,
} from './config.types.js';
import type { ILoggerModule, TTypeOrmLoggerLevels } from './logger.types.js';

export interface IModuleLoggerConfig {
  /**
   * Logger implementation used by initialization, query execution, notifications, and shutdown.
   */
  module: ILoggerModule;
  /**
   * TypeORM log levels forwarded through the configured library logger.
   * Use `all` to enable every TypeORM log level.
   */
  typeormLogLevels?: TTypeOrmLoggerLevels;
}

export interface IModuleConfig {
  /**
   * Database, package, serializer, and key-casing configuration.
   */
  config: TDbConfig;
  logger: IModuleLoggerConfig;
  /**
   * Registers default process signal handlers that call `destroy()`.
   */
  isRegisterShutdownHandlers?: boolean;
  /**
   * Optional entity discovery and synchronization settings for the bundled TypeORM DataSource.
   */
  entity?: IEntityOptions;
  /**
   * Optional migration discovery and startup execution settings.
   */
  migration?: IMigrationOptions;
}
