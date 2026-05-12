import { Client, type ClientConfig } from 'pg';

import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { PostgresConnectionOptions } from '../../typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import { DatabaseConnection } from '../abstract/database-connection.js';

export class PostgreConnection extends DatabaseConnection<
  PostgresConnectionOptions,
  Client
> {
  /**
   * Constructor for PostgreConnection class.
   * Initializes the PostgreConnection object with the provided configuration
   * and logger.
   * @param {DataSource} appDataSource - configuration for the Postgres connection
   * @param {ILoggerModule} logger - logger module to log messages
   */
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule
  ) {
    super(appDataSource, logger);
  }

  /**
   * Creates a single Postgres connection object using the provided configuration.
   *
   * @returns {Promise<Client>} - A promise that resolves with the Postgres client object
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
      keepAliveInitialDelayMillis: 30000,
    };
    const client = new Client(options);
    await client.connect();
    return client;
  }

  public override async pingSingleConnection(
    connection: Client
  ): Promise<void> {
    await connection.query('SELECT 1');
  }

  /**
   * Closes a single Postgres connection object.
   * Removes all listeners from the connection and then ends the connection.
   * Logs an error if the connection close process fails.
   * @param {Client} connection - The connection to close.
   * @returns {Promise<void>} - A promise that resolves when the connection is closed.
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
   * Registers a callback function to be called when the client connection is
   * closed or an error occurs. The callback function can be either a
   * synchronous function or an asynchronous function returning a promise.
   *
   * The callback function will be called with no arguments.
   *
   * If the callback function throws an error, it will be caught and logged
   * to the logger.
   *
   * @param {Client} client - the Postgres Client object
   * @param {(() => void) | Promise<void>} callback - the callback function
   * to be called when the client connection is closed or an error occurs
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
