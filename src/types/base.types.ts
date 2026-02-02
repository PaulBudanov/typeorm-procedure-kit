import type {
  IEntityOptions,
  IMigrationOptions,
  TDbConfig,
} from './config.types.js';
import type { ILoggerModule } from './logger.types.js';

export interface IModuleConfig {
  config: TDbConfig;
  logger: ILoggerModule;
  entity?: IEntityOptions;
  migration?: IMigrationOptions;
}
