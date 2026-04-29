import type {
  IEntityOptions,
  IMigrationOptions,
  TDbConfig,
} from './config.types.js';
import type { ILoggerModule } from './logger.types.js';

export interface IModuleConfig {
  /**
   * Database, package, serializer, and key-casing configuration.
   */
  config: TDbConfig;
  /**
   * Logger implementation used by initialization, query execution, notifications, and shutdown.
   */
  logger: ILoggerModule;
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
