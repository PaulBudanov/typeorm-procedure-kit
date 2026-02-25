import type { TFunction } from '../../types/utility.types.js';

import type { InsertEvent } from './event/InsertEvent.js';
import type { LoadEvent } from './event/LoadEvent.js';
import type { AfterQueryEvent, BeforeQueryEvent } from './event/QueryEvent.js';
import type { RecoverEvent } from './event/RecoverEvent.js';
import type { RemoveEvent } from './event/RemoveEvent.js';
import type { SoftRemoveEvent } from './event/SoftRemoveEvent.js';
import type { TransactionCommitEvent } from './event/TransactionCommitEvent.js';
import type { TransactionRollbackEvent } from './event/TransactionRollbackEvent.js';
import type { TransactionStartEvent } from './event/TransactionStartEvent.js';
import type { UpdateEvent } from './event/UpdateEvent.js';

/**
 * Classes that implement this interface are subscribers that subscribe for the specific events in the ORM.
 */
export interface EntitySubscriberInterface<Entity = unknown> {
  /**
   * Returns the class of the entity to which events will listen.
   * If this method is omitted, then subscriber will listen to events of all entities.
   */
  listenTo?(): TFunction | string;

  /**
   * Called after entity is loaded from the database.
   *
   * For backward compatibility this signature is slightly different from the
   * others.  `event` was added later but is always provided (it is only
   * optional in the signature so that its introduction does not break
   * compilation for existing subscribers).
   */
  afterLoad?(
    entity: Entity,
    event?: LoadEvent<Entity>
  ): Promise<unknown> | void;

  /**
   * Called before query is executed.
   */
  beforeQuery?(event: BeforeQueryEvent): Promise<unknown> | void;

  /**
   * Called after query is executed.
   */
  afterQuery?(event: AfterQueryEvent): Promise<unknown> | void;

  /**
   * Called before entity is inserted to the database.
   */
  beforeInsert?(event: InsertEvent<Entity>): Promise<unknown> | void;

  /**
   * Called after entity is inserted to the database.
   */
  afterInsert?(event: InsertEvent<Entity>): Promise<unknown> | void;

  /**
   * Called before entity is updated in the database.
   */
  beforeUpdate?(event: UpdateEvent<Entity>): Promise<unknown> | void;

  /**
   * Called after entity is updated in the database.
   */
  afterUpdate?(event: UpdateEvent<Entity>): Promise<unknown> | void;

  /**
   * Called before entity is removed from the database.
   */
  beforeRemove?(event: RemoveEvent<Entity>): Promise<unknown> | void;

  /**
   * Called before entity is soft removed from the database.
   */
  beforeSoftRemove?(event: SoftRemoveEvent<Entity>): Promise<unknown> | void;

  /**
   * Called before entity is recovered in the database.
   */
  beforeRecover?(event: RecoverEvent<Entity>): Promise<unknown> | void;

  /**
   * Called after entity is removed from the database.
   */
  afterRemove?(event: RemoveEvent<Entity>): Promise<unknown> | void;

  /**
   * Called after entity is soft removed from the database.
   */
  afterSoftRemove?(event: SoftRemoveEvent<Entity>): Promise<unknown> | void;

  /**
   * Called after entity is recovered in the database.
   */
  afterRecover?(event: RecoverEvent<Entity>): Promise<unknown> | void;

  /**
   * Called before transaction is started.
   */
  beforeTransactionStart?(
    event: TransactionStartEvent
  ): Promise<unknown> | void;

  /**
   * Called after transaction is started.
   */
  afterTransactionStart?(event: TransactionStartEvent): Promise<unknown> | void;

  /**
   * Called before transaction is committed.
   */
  beforeTransactionCommit?(
    event: TransactionCommitEvent
  ): Promise<unknown> | void;

  /**
   * Called after transaction is committed.
   */
  afterTransactionCommit?(
    event: TransactionCommitEvent
  ): Promise<unknown> | void;

  /**
   * Called before transaction rollback.
   */
  beforeTransactionRollback?(
    event: TransactionRollbackEvent
  ): Promise<unknown> | void;

  /**
   * Called after transaction rollback.
   */
  afterTransactionRollback?(
    event: TransactionRollbackEvent
  ): Promise<unknown> | void;
}
