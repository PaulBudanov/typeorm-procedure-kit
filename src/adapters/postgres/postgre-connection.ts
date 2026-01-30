import type { Pool, PoolClient } from 'pg';
import type { DataSource } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';

import type { ILoggerModule } from '../../types/logger.types.js';
import { DatabaseConnection } from '../abstract/database-connection.js';

export class PostgreConnection extends DatabaseConnection<
  Pool,
  PostgresDriver,
  PoolClient
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
   * Retrieves a connection from the master pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * @returns {Promise<PoolClient>} - A promise that resolves with the connection object
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  protected getMasterConnection(): Promise<PoolClient> {
    return (this.nativePoolMaster as Pool).connect();
  }

  /**
   * Retrieves a connection from a random slave pool.
   * If there are no slave pools configured, a warning is logged and the connection is taken from the master pool.
   * @returns {Promise<PoolClient>} - A promise that resolves with the connection object
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  protected getSlaveConnection(): Promise<PoolClient> {
    const randomIndex = Math.floor(
      Math.random() * this.nativePoolSlaves.length
    );
    return (this.nativePoolSlaves[randomIndex] as Pool).connect();
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
   * @param {PoolClient} client - the Postgres PoolClient object
   * @param {(() => void) | Promise<void>} callback - the callback function
   * to be called when the client connection is closed or an error occurs
   */
  public registerConnectionErrorHandler(
    client: PoolClient,
    callback: () => void | Promise<void>
  ): void {
    client.on('error', (err) => {
      this.logger.error(`Postgres client error: ${err.message}`, err.stack);
      client.removeAllListeners('error');
      try {
        void callback();
      } catch (error: unknown) {
        this.logger.error(
          `Callback error: ${(error as Error).message}`,
          (error as Error).stack
        );
      }
    });
    client.on('end', () => {
      this.logger.error('Postgres client connection closed');
      client.removeAllListeners('end');
      try {
        void callback();
      } catch (error: unknown) {
        this.logger.error(
          `Callback error: ${(error as Error).message}`,
          (error as Error).stack
        );
      }
    });
  }
}
