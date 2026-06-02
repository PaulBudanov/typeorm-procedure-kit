import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { QueryRunner } from '../typeorm/query-runner/QueryRunner.js';
import type { TConnectionMode } from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import { ServerError } from '../utils/server-error.js';
export class ConnectionBase {
  public constructor(
    private readonly appDataSource: DataSource,
    private readonly logger: ILoggerModule
  ) {}

  /**
   * Retrieves an EntityManager from the pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * If `slave` mode is explicitly requested without configured slave databases,
   * a warning is logged and the driver fallback uses the master connection.
   * @param {string} [mode] - The mode of the connection. 'master' or 'slave'. Defaults to 'master'.
   * @returns {Promise<EntityManager>} - A promise that resolves with the EntityManager.
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  public async getEntityManager(
    mode: TConnectionMode = 'master'
  ): Promise<EntityManager> {
    try {
      if (this.appDataSource.isInitialized) {
        this.warnWhenSlaveModeFallsBackToMaster(mode);
        const queryRunner: QueryRunner =
          this.appDataSource.createQueryRunner(mode);
        await queryRunner.connect();
        const entityManager: EntityManager = queryRunner.manager;
        if (!entityManager.connection.isInitialized)
          throw new ServerError('Connection not initialized');
        return entityManager;
      }
      throw new ServerError('Connection to Database not established');
    } catch (e: unknown) {
      this.logger.error(
        'Error getting connection from pool',
        (e as Error).stack
      );
      throw e;
    }
  }

  /**
   * Logs a warning when slave mode cannot be satisfied by the current
   * DataSource configuration and the underlying driver will use master instead.
   *
   * Driver-level replication can fall back from slave to master when no slave
   * pools exist. Public kit APIs keep that fallback behavior but make it visible
   * through the configured logger.
   *
   * @param mode - Requested connection mode.
   */
  private warnWhenSlaveModeFallsBackToMaster(mode: TConnectionMode): void {
    if (mode !== 'slave') return;

    const slaves = this.appDataSource.options.replication?.slaves;
    if (Array.isArray(slaves) && slaves.length > 0) return;

    this.logger.warn(
      'Slave connection requested but no slave databases configured. Using master connection.'
    );
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
