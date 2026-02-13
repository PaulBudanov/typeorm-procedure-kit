import { DataSource } from '../data-source/DataSource';
import { EntityManager } from './EntityManager.js';
import { QueryRunner } from '../query-runner/QueryRunner';

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
