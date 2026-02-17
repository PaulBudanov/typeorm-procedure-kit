import { ObjectLiteral } from '../../common/ObjectLiteral';
import { DataSource } from '../../data-source/DataSource';
import { EntityManager } from '../../entity-manager/EntityManager';
import { ColumnMetadata } from '../../metadata/ColumnMetadata';
import { EntityMetadata } from '../../metadata/EntityMetadata';
import { RelationMetadata } from '../../metadata/RelationMetadata';
import { QueryRunner } from '../../query-runner/QueryRunner';

/**
 * UpdateEvent is an object that broadcaster sends to the entity subscriber when entity is being updated in the database.
 */
export interface UpdateEvent<Entity> {
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

  /**
   * Updating entity.
   *
   * Contains the same data that was passed to the updating method, be it the instance of an entity or the partial entity.
   */
  entity: ObjectLiteral | undefined;

  /**
   * Metadata of the entity.
   */
  metadata: EntityMetadata;

  /**
   * Updating entity in the database.
   *
   * Is set only when one of the following methods are used: .save(), .remove(), .softRemove(), and .recover()
   */
  databaseEntity: Entity;

  /**
   * List of updated columns. In query builder has no affected
   */
  updatedColumns: Array<ColumnMetadata>;

  /**
   * List of updated relations. In query builder has no affected
   */
  updatedRelations: Array<RelationMetadata>;
}
