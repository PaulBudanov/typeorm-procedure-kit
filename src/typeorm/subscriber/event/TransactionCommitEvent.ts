import { DataSource } from '../../data-source/DataSource.js';
import { EntityManager } from '../../entity-manager/EntityManager.js';
import type { QueryRunner } from '../../query-runner/QueryRunner.js';

/**
 * TransactionCommitEvent is an object that broadcaster sends to the entity subscriber when an transaction is committed.
 */
export interface TransactionCommitEvent {
  /**
   * Connection used in the event.
   */
  connection: DataSource;

  /**
   * QueryRunner used in the event transaction.
   * All database operations in the subscribed event listener should be performed using this query runner instance.
   */
  queryRunner: QueryRunner;

  /**
   * EntityManager used in the event transaction.
   * All database operations in the subscribed event listener should be performed using this entity manager instance.
   */
  manager: EntityManager;
}
