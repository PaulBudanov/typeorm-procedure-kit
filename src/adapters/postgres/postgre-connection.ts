import { type Pool, type PoolClient } from 'pg';
import type { DataSource } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';

import type { ILoggerModule, TConnectionMode } from '../../types.js';
export class PostgreConnection {
  private nativePoolMaster: Pool;
  private nativePoolSlaves: Array<Pool>;
  /**
   * Constructor for PostgreConnection class.
   * Initializes the PostgreConnection object with the provided configuration
   * and logger.
   * @param {DataSource} appDataSource - configuration for the Postgres connection
   * @param {ILoggerModule} logger - logger module to log messages
   */
  protected constructor(
    protected appDataSource: DataSource,
    protected logger: ILoggerModule,
  ) {
    this.nativePoolMaster = (this.appDataSource.driver as PostgresDriver)
      .master as Pool;

    this.nativePoolSlaves = (this.appDataSource.driver as PostgresDriver)
      .slaves as Array<Pool>;
  }
  //TODO: Add usecases for master and slave

  /**
   * Creates a new Postgres client object and connects to the database.
   * If the mode is 'master', the connection is taken from the master pool.
   * If the mode is 'slave', the connection is taken from a random slave pool.
   * If there are no slave pools configured, a warning is logged and the connection is taken from the master pool.
   * @param {TConnectionMode} mode - The mode of the connection. 'master' or 'slave'. Defaults to 'master'.
   * @returns {Promise<PoolClient>} - A promise that resolves with the Postgres client object
   */
  public async getConnectionFromPool(
    mode: TConnectionMode = 'master',
  ): Promise<PoolClient> {
    if (
      mode === 'master' ||
      (mode === 'slave' && this.nativePoolSlaves.length === 0)
    ) {
      if (mode === 'slave')
        this.logger.warn('No slave pools configured, using master pool!');
      return await this.nativePoolMaster.connect();
    } else {
      return await this.nativePoolSlaves[
        Math.floor(Math.random() * this.nativePoolSlaves.length)
      ].connect();
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
   * @param {PoolClient} client - the Postgres PoolClient object
   * @param {(() => void) | Promise<void>} callback - the callback function
   * to be called when the client connection is closed or an error occurs
   */
  protected registerConnectionErrorHandler(
    client: PoolClient,
    callback: () => void | Promise<void>,
  ): void {
    client.on('error', (err) => {
      this.logger.error(`Postgres client error: ${err.message}`, err.stack);
      client.removeAllListeners('error');
      try {
        void callback();
      } catch (error: unknown) {
        this.logger.error(
          `Callback error: ${(error as Error).message}`,
          (error as Error).stack,
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
          (error as Error).stack,
        );
      }
    });
  }

  /**
   * Releases a Postgres client connection.
   * This method is used to explicitly release a Postgres client connection.
   * It removes all listeners from the client and then calls the end() method
   * to release the connection.
   * If an error occurs during the release process, it will be caught and logged
   * to the logger.
   * @param {PoolClient} client - the Postgres PoolClient object
   * @returns {Promise<void>} - a promise that resolves when the connection is released
   */
  public releaseConnectionFromPool(client: PoolClient): void {
    try {
      client.removeAllListeners();
      client.release();
      this.logger.log('Postgres client connection released successfully');
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Postgres client connection release error: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
