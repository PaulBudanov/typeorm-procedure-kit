import { DataSource, EntityManager } from 'typeorm';

import type { TConnectionMode } from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
export class ConnectionBase {
  public constructor(
    private readonly appDataSource: DataSource,
    private readonly logger: ILoggerModule
  ) {}

  /**
   * Retrieves an EntityManager from the pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * @param {string} [mode] - The mode of the connection. 'master' or 'slave'. Defaults to 'master'.
   * @returns {Promise<EntityManager>} - A promise that resolves with the EntityManager.
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  public async getEntityManager(
    mode: TConnectionMode = 'master'
  ): Promise<EntityManager> {
    try {
      if (this.appDataSource.isInitialized) {
        const queryRunner = this.appDataSource.createQueryRunner(mode);
        await queryRunner.connect();
        const entityManager = queryRunner.manager;
        if (!entityManager.connection.isInitialized)
          throw new Error('Connection not initialized');
        return entityManager;
      }
      throw new Error('Connection to Database not established');
    } catch (e: unknown) {
      this.logger.error(
        'Error getting connection from pool',
        (e as Error).stack
      );
      throw e;
    }
  }

  /**
   * Releases a connection to the database back to the pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * @param {EntityManager} connection - The connection to release.
   * @returns {Promise<void>} - A promise that resolves when the connection is released.
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  public async releaseEntityManager(connection: EntityManager): Promise<void> {
    try {
      if (connection) await connection.release();
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Connection release error, err: ${(error as Error).message}`,
        (error as Error).stack
      );
      return;
    }
  }
}
