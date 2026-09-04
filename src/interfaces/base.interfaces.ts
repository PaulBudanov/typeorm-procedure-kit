import type { IEntityOptions, IMigrationOptions } from './config.interfaces.js';
import type { ILoggerModule } from './logger.interfaces.js';
import type { TDbConfig } from '../types/config.types.js';
import type {
  TBindingLogMode,
  TTypeOrmLoggerLevels,
} from '../types/logger.types.js';

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
  /**
   * Controls binding values written to query logs. The default is
   * `metadata-only`, which hides every value. `redact-by-name` is a less strict
   * compatibility mode; `unsafe-values` exposes values explicitly.
   */
  bindingLogMode?: TBindingLogMode;
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
