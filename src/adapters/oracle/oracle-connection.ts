import oracledb from 'oracledb';
import type { DataSource } from 'typeorm';
import type { OracleConnectionOptions } from 'typeorm/driver/oracle/OracleConnectionOptions.js';
import type { OracleDriver } from 'typeorm/driver/oracle/OracleDriver.js';

import type { ILoggerModule } from '../../types/logger.types.js';
import { DatabaseConnection } from '../abstract/database-connection.js';

export class OracleConnection extends DatabaseConnection<
  oracledb.Pool,
  OracleDriver,
  oracledb.Connection
> {
  private options: OracleConnectionOptions;

  /**
   * Constructor for OracleConnection class.
   * Initializes the OracleConnection object with the provided configuration
   * and logger.
   * @param {DataSource} appDataSource - configuration for the Oracle connection
   * @param {ILoggerModule} logger - logger module to log messages
   */
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule
  ) {
    super(appDataSource, logger);
    this.options = this.appDataSource.options as OracleConnectionOptions;
  }

  /**
   * Retrieves a connection from the master pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * @returns {Promise<oracledb.Connection>} - A promise that resolves with the connection object
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  protected getMasterConnection(): Promise<oracledb.Connection> {
    return (this.nativePoolMaster as oracledb.Pool).getConnection();
  }

  /**
   * Retrieves a connection from a random slave pool.
   * If there are no slave pools configured, a warning is logged and the connection is taken from the master pool.
   * @returns {Promise<oracledb.Connection>} - A promise that resolves with the connection object
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  protected getSlaveConnection(): Promise<oracledb.Connection> {
    const randomIndex = Math.floor(
      Math.random() * this.nativePoolSlaves.length
    );
    return (
      this.nativePoolSlaves[randomIndex] as oracledb.Pool
    ).getConnection();
  }
  /**
   * Creates a single Oracle connection object using the provided configuration.
   * @returns {Promise<oracledb.Connection>} - A promise that resolves with the Oracle client object
   */
  public async createSingleConnection(): Promise<oracledb.Connection> {
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
  public async closeSingleConnection(
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
