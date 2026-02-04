import oracledb from 'oracledb';
import type { DataSource } from 'typeorm';
import type { OracleConnectionOptions } from 'typeorm/driver/oracle/OracleConnectionOptions.js';

import type { ILoggerModule } from '../../types/logger.types.js';
import { DatabaseConnection } from '../abstract/database-connection.js';

export class OracleConnection extends DatabaseConnection<
  OracleConnectionOptions,
  oracledb.Connection
> {
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
  }

  /**
   * Creates a single Oracle connection object using the provided configuration.
   * @returns {Promise<oracledb.Connection>} - A promise that resolves with the Oracle client object
   */
  public override async createSingleConnection(): Promise<oracledb.Connection> {
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
