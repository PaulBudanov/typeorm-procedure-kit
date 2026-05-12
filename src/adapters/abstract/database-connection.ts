import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type {
  TConnectionOptions,
  TConnectionTypes,
} from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';

export abstract class DatabaseConnection<
  U extends TConnectionOptions,
  V extends TConnectionTypes,
> {
  private static readonly CONNECTION_HEALTH_CHECK_TIMEOUT_MS = 10000;

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

  public abstract pingSingleConnection(connection: V): Promise<void>;

  public async isSingleConnectionHealthy(
    connection: V,
    timeoutMs = DatabaseConnection.CONNECTION_HEALTH_CHECK_TIMEOUT_MS
  ): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.pingSingleConnection(connection),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `Database connection health check timed out after ${timeoutMs}ms`
              )
            );
          }, timeoutMs);
          timeout.unref();
        }),
      ]);
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `Database connection health check failed: ${(error as Error).message}`
      );
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  public registerConnectionErrorHandler(
    _connection: V,
    _callback: () => void | Promise<void>
  ): void {
    return;
  }
}
