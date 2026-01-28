import oracledb from 'oracledb';
import type { DataSource } from 'typeorm';
import type { OracleConnectionOptions } from 'typeorm/driver/oracle/OracleConnectionOptions.js';
import type { OracleDriver } from 'typeorm/driver/oracle/OracleDriver.js';

import type { ILoggerModule, TConnectionMode } from '../../types.js';

export class OracleConnection {
  private nativePoolMaster: oracledb.Pool;
  private nativePoolSlaves: Array<oracledb.Pool>;
  private options: OracleConnectionOptions;

  /**
   * Constructor for OracleConnection class.
   * Initializes the OracleConnection object with the provided configuration
   * and logger.
   * @param {DataSource} appDataSource - configuration for the Oracle connection
   * @param {ILoggerModule} logger - logger module to log messages
   */
  protected constructor(
    protected appDataSource: DataSource,
    protected logger: ILoggerModule,
  ) {
    this.nativePoolMaster = (this.appDataSource.driver as OracleDriver)
      .master as oracledb.Pool;

    this.nativePoolSlaves = (this.appDataSource.driver as OracleDriver)
      .slaves as Array<oracledb.Pool>;

    this.options = this.appDataSource.options as OracleConnectionOptions;
  }
  /**
   * Releases a connection to the database back to the pool.
   * If the connection is not initialized, throws an error.
   * @param {oracledb.Connection} client - The connection to release.
   * @returns {Promise<void>} - A promise that resolves when the connection is released.
   * @throws {Error} - If the connection is not initialized.
   */
  public async releaseConnectionFromPool(
    client: oracledb.Connection,
  ): Promise<void> {
    try {
      await client.release();
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Oracle client connection release error: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  //TODO: Add usecases for master and slave
  /**
   * Creates a new Oracle connection object and connects to the database.
   * If the mode is 'master', the connection is taken from the master pool.
   * If the mode is 'slave', the connection is taken from a random slave pool.
   * If there are no slave pools configured, a warning is logged and the connection is taken from the master pool.
   * @param {string} mode - The mode of the connection. 'master' or 'slave'. Defaults to 'master'.
   * @returns {Promise<oracledb.Connection>} - A promise that resolves with the Oracle client object
   */
  public async getConnectionFromPool(
    mode: TConnectionMode = 'master',
  ): Promise<oracledb.Connection> {
    if (
      mode === 'master' ||
      (mode === 'slave' && this.nativePoolSlaves.length === 0)
    ) {
      if (mode === 'slave')
        this.logger.warn('No slave pools configured, using master pool');
      return this.nativePoolMaster.getConnection();
    } else {
      return this.nativePoolSlaves[
        Math.random() * this.nativePoolSlaves.length
      ].getConnection();
    }
  }

  /**
   * Creates a single Oracle connection object using the provided configuration.
   * @returns {Promise<oracledb.Connection>} - A promise that resolves with the Oracle client object
   */
  protected async createSingleConnection(): Promise<oracledb.Connection> {
    const options: oracledb.ConnectionAttributes = {
      user: this.options.username,
      password: this.options.password,
      connectString: `${this.options.host}:${this.options.port}/${this.options.database}`,
      events: true,
      transportConnectTimeout: 10,
    };
    return oracledb.getConnection(options);
  }

  /**
   * Closes a single Oracle connection object.
   * Logs an error if the connection close process fails.
   * @param {oracledb.Connection} connection - The connection to close.
   * @returns {Promise<void>} - A promise that resolves when the connection is closed.
   */
  protected async closeSingleConnection(
    connection: oracledb.Connection,
  ): Promise<void> {
    try {
      await connection.close();
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Oracle client connection close error: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
