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
    //? Maybe need get config options for create single connection from  class constructor. This doesn't look very good.
    this.options = (this.appDataSource.options as U).replication?.master as U;
  }
  public abstract createSingleConnection(): Promise<V>;

  public abstract closeSingleConnection(connection: V): Promise<void>;
}
