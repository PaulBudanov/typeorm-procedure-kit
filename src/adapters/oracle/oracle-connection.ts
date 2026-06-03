import oracledb from 'oracledb';

import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { OracleConnectionOptions } from '../../typeorm/driver/oracle/OracleConnectionOptions.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import { normalizeQueryTimeoutMs } from '../../utils/query-timeout.js';
import { ServerError } from '../../utils/server-error.js';
import { DatabaseConnection } from '../abstract/database-connection.js';

export class OracleConnection extends DatabaseConnection<
  OracleConnectionOptions,
  oracledb.Connection
> {
  /**
   * Creates the Oracle single-connection helper.
   * @param appDataSource - initialized data source with Oracle options.
   * @param logger - logger used by connection operations.
   */
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule
  ) {
    super(appDataSource, logger);
  }

  /**
   * Creates one standalone Oracle connection using the master connection options.
   * CQN events are enabled because notification subscriptions use these
   * connections.
   * @returns connected Oracle connection.
   */
  public override async createSingleConnection(): Promise<oracledb.Connection> {
    const options: oracledb.ConnectionAttributes = {
      user: this.options.username,
      password: this.options.password,
      connectString: `${this.options.host}:${this.options.port}/${this.options.database}`,
      events: true,
      transportConnectTimeout: 10,
    };
    const connection = await oracledb.getConnection(options);
    this.applyConnectionCallTimeout(connection);
    return connection;
  }

  private applyConnectionCallTimeout(connection: oracledb.Connection): void {
    const dataSourceOptions = this.appDataSource
      .options as OracleConnectionOptions;
    const queryTimeoutMs =
      normalizeQueryTimeoutMs(dataSourceOptions.queryTimeoutMs) ??
      normalizeQueryTimeoutMs(this.options.queryTimeoutMs);
    if (queryTimeoutMs !== undefined) {
      connection.callTimeout = queryTimeoutMs;
    }
  }

  /**
   * Pings a standalone Oracle connection.
   * Oracle's synchronous isHealthy check is evaluated before ping to catch
   * already closed connections quickly.
   * @param connection - connection to ping.
   */
  public override async pingSingleConnection(
    connection: oracledb.Connection
  ): Promise<void> {
    if (!connection.isHealthy())
      throw new ServerError('Oracle connection is unhealthy');
    await connection.ping();
  }

  /**
   * Closes a standalone Oracle connection.
   * Logs an error if the connection close process fails.
   * @param connection - connection to close.
   */
  public override async closeSingleConnection(
    connection: oracledb.Connection
  ): Promise<void> {
    try {
      await connection.close();
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Oracle client connection close error: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }
}
