import type { DataSource } from '../data-source/DataSource.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';

import { EntityManager } from './EntityManager.js';

/**
 * Helps to create entity managers.
 */
export abstract class EntityManagerFactory {
  /**
   * Creates a new entity manager depend on a given connection's driver.
   */
  public static create(
    connection: DataSource,
    queryRunner?: QueryRunner
  ): EntityManager {
    return new EntityManager(connection, queryRunner);
  }
}
