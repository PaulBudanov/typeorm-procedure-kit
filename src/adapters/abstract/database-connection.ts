import type { DataSource } from 'typeorm';

import type {
  TConnectionOptions,
  TConnectionTypes,
} from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';

export abstract class DatabaseConnection<
  U extends TConnectionOptions,
  V extends TConnectionTypes,
> {
  protected options: U;
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule
  ) {
    this.options = this.appDataSource.options as U;
  }
  public abstract createSingleConnection(): Promise<V>;

  public abstract closeSingleConnection(connection: V): Promise<void>;
}
