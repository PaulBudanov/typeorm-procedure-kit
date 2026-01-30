import type { DataSource } from 'typeorm';

import type {
  TConnectionTypes,
  TPoolTypes,
  TTypeOrmDriver,
} from '../../types/adapter.types.js';
import type { TConnectionMode } from '../../types/config.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';

export abstract class DatabaseConnection<
  U extends TPoolTypes,
  T extends TTypeOrmDriver,
  V extends TConnectionTypes,
> {
  protected nativePoolMaster: U;
  protected nativePoolSlaves: Array<U>;

  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule
  ) {
    const driver = this.appDataSource.driver as T;
    this.nativePoolMaster = driver.master as U;
    this.nativePoolSlaves = driver.slaves as Array<U>;
  }

  /**
   * Releases a connection to the database back to the pool.
   * If the connection is not initialized, throws an error.
   * @param {oracledb.Connection | PoolClient} client - The connection to release.
   * @returns {Promise<void>} - A promise that resolves when the connection is released.
   * @throws {Error} - If the connection is not initialized.
   */
  public async releaseConnectionFromPool(
    client: V,
    callback?: (client: V) => void | Promise<void>
  ): Promise<void> {
    try {
      if (callback) {
        await callback(client);
      }
      await Promise.resolve(client.release());
      this.logger.log('Database client connection released successfully');
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Oracle client connection release error: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }

  /**
   * Retrieves a connection from the master pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * @returns {Promise<V>} - A promise that resolves with the connection object
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  protected abstract getMasterConnection(): Promise<V>;

  /**
   * Retrieves a connection from a random slave pool.
   * If there are no slave pools configured, a warning is logged and the connection is taken from the master pool.
   * @returns {Promise<V>} - A promise that resolves with the connection object
   */
  protected abstract getSlaveConnection(): Promise<V>;

  public async getConnectionFromPool(
    /**
     * Retrieves a connection from the master or slave pool.
     * If the mode is 'master', the connection is taken from the master pool.
     * If the mode is 'slave', the connection is taken from a random slave pool.
     * If there are no slave pools configured, a warning is logged and the connection is taken from the master pool.
     * @param {TConnectionMode} [mode] - The mode of the connection. 'master' or 'slave'. Defaults to 'master'.
     * @returns {Promise<V>} - A promise that resolves with the connection object
     * @throws {Error} - If the connection to the database is not established or the connection is not initialized
     */
    mode: TConnectionMode = 'master'
  ): Promise<V> {
    try {
      if (
        mode === 'master' ||
        (mode === 'slave' && this.nativePoolSlaves.length === 0)
      ) {
        if (mode === 'slave') {
          this.logger.warn('No slave pools configured, using master pool');
        }
        return await this.getMasterConnection();
      } else {
        return await this.getSlaveConnection();
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get connection from pool (${mode}): ${(error as Error).message}`,
        (error as Error).stack
      );
      throw error;
    }
  }
}
