import { Client, type ClientConfig } from 'pg';

import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { PostgresConnectionOptions } from '../../typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import { DatabaseConnection } from '../abstract/database-connection.js';

export class PostgreConnection extends DatabaseConnection<
  PostgresConnectionOptions,
  Client
> {
  private readonly connectionTimeoutMs = 1000 * 15;
  private readonly keepAliveInitialDelayMillis = 1000 * 10;

  /**
   * Creates the Postgres single-connection helper.
   * @param appDataSource - initialized data source with Postgres options.
   * @param logger - logger used by connection operations.
   */
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule
  ) {
    super(appDataSource, logger);
  }

  /**
   * Creates one standalone Postgres client using the master connection options.
   *
   * @returns connected Postgres client.
   */
  public override async createSingleConnection(): Promise<Client> {
    const options: ClientConfig = {
      application_name: this.options.applicationName,
      host: this.options.host,
      port: this.options.port,
      user: this.options.username,
      password: this.options.password,
      database: this.options.database,
      keepAlive: true,
      keepAliveInitialDelayMillis: this.keepAliveInitialDelayMillis,
      connectionTimeoutMillis: this.connectionTimeoutMs,
    };
    const client = new Client(options);
    await client.connect();
    return client;
  }

  /**
   * Pings a standalone Postgres client.
   * @param connection - client to ping.
   */
  public override async pingSingleConnection(
    connection: Client
  ): Promise<void> {
    await connection.query('SELECT 1');
  }

  /**
   * Closes a standalone Postgres client.
   * Removes all listeners from the connection and then ends the connection.
   * Logs an error if the connection close process fails.
   * @param connection - client to close.
   */
  public override async closeSingleConnection(
    connection: Client
  ): Promise<void> {
    try {
      connection.removeAllListeners();
      await connection.end();
      this.logger.log('Postgres client connection released successfully');
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Postgres client connection release error: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }

  /**
   * Registers one connection-loss callback for a Postgres client.
   * The callback is invoked once on the first `error` or `end` event, then the
   * event listeners are removed to avoid duplicate restore attempts.
   *
   * @param client - Postgres client to observe.
   * @param callback - callback called when the client connection closes or errors.
   */
  public override registerConnectionErrorHandler(
    client: Client,
    callback: () => void | Promise<void>
  ): void {
    let isHandled = false;

    const handleConnectionLoss = (reason: string, error?: Error): void => {
      if (isHandled) return;
      isHandled = true;
      client.removeListener('error', onError);
      client.removeListener('end', onEnd);
      if (error)
        this.logger.error(
          `Postgres client ${reason}: ${error.message}`,
          error.stack
        );
      else this.logger.error(`Postgres client ${reason}`);
      try {
        void callback();
      } catch (callbackError: unknown) {
        this.logger.error(
          `Callback error: ${(callbackError as Error).message}`,
          (callbackError as Error).stack
        );
      }
    };

    const onError = (err: Error): void => {
      handleConnectionLoss('error', err);
    };

    const onEnd = (): void => {
      handleConnectionLoss('connection closed');
    };

    client.on('error', onError);
    client.on('end', onEnd);
  }
}
