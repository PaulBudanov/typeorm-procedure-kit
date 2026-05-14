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
  private readonly CONNECTION_HEALTH_CHECK_TIMEOUT_MS = 10000;

  protected options: U;
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule
  ) {
    this.options = (this.appDataSource.options as U).replication?.master as U;
  }

  /**
   * Creates one standalone database connection outside the TypeORM pool.
   * Notification adapters use this connection for LISTEN/CQN subscriptions.
   */
  public abstract createSingleConnection(): Promise<V>;

  /**
   * Closes a standalone database connection.
   * Implementations must absorb and log close errors so cleanup paths can
   * continue closing the remaining resources.
   * @param connection - standalone connection to close.
   */
  public abstract closeSingleConnection(connection: V): Promise<void>;

  /**
   * Performs a vendor-specific liveness check for a standalone connection.
   * @param connection - standalone connection to ping.
   */
  public abstract pingSingleConnection(connection: V): Promise<void>;

  /**
   * Checks whether a standalone connection responds before the timeout.
   * @param connection - standalone connection to check.
   * @param timeoutMs - maximum ping duration in milliseconds.
   * @returns true when the ping succeeds before timeout, otherwise false.
   */
  public async isSingleConnectionHealthy(
    connection: V,
    timeoutMs = this.CONNECTION_HEALTH_CHECK_TIMEOUT_MS
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
      if (timeoutMs === this.CONNECTION_HEALTH_CHECK_TIMEOUT_MS)
        this.logger.warn(
          `Database connection health check failed: ${(error as Error).message}`
        );
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Registers a connection-loss callback for drivers that expose error/end
   * events. Adapters without such events can keep the default no-op.
   * @param _connection - standalone connection to observe.
   * @param _callback - callback invoked after connection loss.
   */
  public registerConnectionErrorHandler(
    _connection: V,
    _callback: () => void | Promise<void>
  ): void {
    return;
  }
}
