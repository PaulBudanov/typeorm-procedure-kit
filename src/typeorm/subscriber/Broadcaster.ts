import type { TFunction } from '../../types/utility.types.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { ColumnMetadata } from '../metadata/ColumnMetadata.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { BroadcasterResult } from './BroadcasterResult.js';
import type { EntitySubscriberInterface } from './EntitySubscriberInterface.js';

interface BroadcasterEvents {
  BeforeQuery: (query: string, parameters: Array<unknown> | undefined) => void;
  AfterQuery: (
    query: string,
    parameters: Array<unknown> | undefined,
    success: boolean,
    executionTime: number | undefined,
    rawResults: unknown | undefined,
    error: unknown | undefined
  ) => void;

  BeforeTransactionCommit: () => void;
  AfterTransactionCommit: () => void;
  BeforeTransactionStart: () => void;
  AfterTransactionStart: () => void;
  BeforeTransactionRollback: () => void;
  AfterTransactionRollback: () => void;

  BeforeUpdate: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    updatedColumns?: Array<ColumnMetadata>,
    updatedRelations?: Array<RelationMetadata>
  ) => void;
  AfterUpdate: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    updatedColumns?: Array<ColumnMetadata>,
    updatedRelations?: Array<RelationMetadata>
  ) => void;

  BeforeInsert: (
    metadata: EntityMetadata,
    entity: ObjectLiteral | undefined
  ) => void;
  AfterInsert: (
    metadata: EntityMetadata,
    entity: ObjectLiteral | undefined
  ) => void;

  BeforeRemove: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral
  ) => void;
  AfterRemove: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral
  ) => void;

  BeforeSoftRemove: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral
  ) => void;
  AfterSoftRemove: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral
  ) => void;

  BeforeRecover: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral
  ) => void;
  AfterRecover: (
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral
  ) => void;

  Load: (metadata: EntityMetadata, entities: Array<ObjectLiteral>) => void;
}

/**
 * Broadcaster provides a helper methods to broadcast events to the subscribers.
 */
export class Broadcaster {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(private queryRunner: QueryRunner) {}

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public async broadcast<U extends keyof BroadcasterEvents>(
    event: U,
    ...args: Parameters<BroadcasterEvents[U]>
  ): Promise<void> {
    const result = new BroadcasterResult();

    const broadcastFunction = this[`broadcast${event}Event` as keyof this];

    if (typeof broadcastFunction === 'function') {
      (broadcastFunction as TFunction).call(this, result, ...args);
    }

    await result.wait();
  }

  /**
   * Broadcasts "BEFORE_INSERT" event.
   * Before insert event is executed before entity is being inserted to the database for the first time.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastBeforeInsertEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity: undefined | ObjectLiteral
  ): void {
    if (entity && metadata.beforeInsertListeners.length) {
      metadata.beforeInsertListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.beforeInsert
        ) {
          const executionResult = subscriber.beforeInsert({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_UPDATE" event.
   * Before update event is executed before entity is being updated in the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastBeforeUpdateEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    updatedColumns?: Array<ColumnMetadata>,
    updatedRelations?: Array<RelationMetadata>
  ): void {
    // todo: send relations too?
    if (entity && metadata.beforeUpdateListeners.length) {
      metadata.beforeUpdateListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.beforeUpdate
        ) {
          const executionResult = subscriber.beforeUpdate({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            updatedColumns: updatedColumns || [],
            updatedRelations: updatedRelations || [],
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_REMOVE" event.
   * Before remove event is executed before entity is being removed from the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastBeforeRemoveEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    identifier?: ObjectLiteral
  ): void {
    if (entity && metadata.beforeRemoveListeners.length) {
      metadata.beforeRemoveListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.beforeRemove
        ) {
          const executionResult = subscriber.beforeRemove({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            entityId: metadata.getEntityIdMixedMap(
              databaseEntity ?? identifier
            ),
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_SOFT_REMOVE" event.
   * Before soft remove event is executed before entity is being soft removed from the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastBeforeSoftRemoveEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    identifier?: ObjectLiteral
  ): void {
    if (entity && metadata.beforeSoftRemoveListeners.length) {
      metadata.beforeSoftRemoveListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.beforeSoftRemove
        ) {
          const executionResult = subscriber.beforeSoftRemove({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            entityId: metadata.getEntityIdMixedMap(
              databaseEntity ?? identifier
            ),
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_RECOVER" event.
   * Before recover event is executed before entity is being recovered in the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastBeforeRecoverEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    identifier?: ObjectLiteral
  ): void {
    if (entity && metadata.beforeRecoverListeners.length) {
      metadata.beforeRecoverListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.beforeRecover
        ) {
          const executionResult = subscriber.beforeRecover({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            entityId: metadata.getEntityIdMixedMap(
              databaseEntity ?? identifier
            ),
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_INSERT" event.
   * After insert event is executed after entity is being persisted to the database for the first time.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastAfterInsertEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    identifier?: ObjectLiteral
  ): void {
    if (entity && metadata.afterInsertListeners.length) {
      metadata.afterInsertListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.afterInsert
        ) {
          const executionResult = subscriber.afterInsert({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            entityId: metadata.getEntityIdMixedMap(identifier) as
              | ObjectLiteral
              | undefined,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_QUERY" event.
   */
  public broadcastBeforeQueryEvent(
    result: BroadcasterResult,
    query: string,
    parameters: undefined | Array<unknown>
  ): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.beforeQuery) {
          const executionResult = subscriber.beforeQuery({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            query: query,
            parameters: parameters,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_QUERY" event.
   */
  public broadcastAfterQueryEvent(
    result: BroadcasterResult,
    query: string,
    parameters: undefined | Array<unknown>,
    success: boolean,
    executionTime: undefined | number,
    rawResults: undefined | unknown,
    error: undefined | unknown
  ): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.afterQuery) {
          const executionResult = subscriber.afterQuery({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            query: query,
            parameters: parameters,
            success: success,
            executionTime: executionTime,
            rawResults: rawResults,
            error: error,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_TRANSACTION_START" event.
   */
  public broadcastBeforeTransactionStartEvent(result: BroadcasterResult): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.beforeTransactionStart) {
          const executionResult = subscriber.beforeTransactionStart({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_TRANSACTION_START" event.
   */
  public broadcastAfterTransactionStartEvent(result: BroadcasterResult): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.afterTransactionStart) {
          const executionResult = subscriber.afterTransactionStart({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_TRANSACTION_COMMIT" event.
   */
  public broadcastBeforeTransactionCommitEvent(
    result: BroadcasterResult
  ): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.beforeTransactionCommit) {
          const executionResult = subscriber.beforeTransactionCommit({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_TRANSACTION_COMMIT" event.
   */
  public broadcastAfterTransactionCommitEvent(result: BroadcasterResult): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.afterTransactionCommit) {
          const executionResult = subscriber.afterTransactionCommit({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "BEFORE_TRANSACTION_ROLLBACK" event.
   */
  public broadcastBeforeTransactionRollbackEvent(
    result: BroadcasterResult
  ): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.beforeTransactionRollback) {
          const executionResult = subscriber.beforeTransactionRollback({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_TRANSACTION_ROLLBACK" event.
   */
  public broadcastAfterTransactionRollbackEvent(
    result: BroadcasterResult
  ): void {
    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (subscriber.afterTransactionRollback) {
          const executionResult = subscriber.afterTransactionRollback({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_UPDATE" event.
   * After update event is executed after entity is being updated in the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastAfterUpdateEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    updatedColumns?: Array<ColumnMetadata>,
    updatedRelations?: Array<RelationMetadata>
  ): void {
    if (entity && metadata.afterUpdateListeners.length) {
      metadata.afterUpdateListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.afterUpdate
        ) {
          const executionResult = subscriber.afterUpdate({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            updatedColumns: updatedColumns || [],
            updatedRelations: updatedRelations || [],
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_REMOVE" event.
   * After remove event is executed after entity is being removed from the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastAfterRemoveEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    identifier?: ObjectLiteral
  ): void {
    if (entity && metadata.afterRemoveListeners.length) {
      metadata.afterRemoveListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.afterRemove
        ) {
          const executionResult = subscriber.afterRemove({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            entityId: metadata.getEntityIdMixedMap(
              databaseEntity ?? identifier
            ),
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_SOFT_REMOVE" event.
   * After soft remove event is executed after entity is being soft removed from the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastAfterSoftRemoveEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    identifier?: ObjectLiteral
  ): void {
    if (entity && metadata.afterSoftRemoveListeners.length) {
      metadata.afterSoftRemoveListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.afterSoftRemove
        ) {
          const executionResult = subscriber.afterSoftRemove({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            entityId: metadata.getEntityIdMixedMap(
              databaseEntity ?? identifier
            ),
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * Broadcasts "AFTER_RECOVER" event.
   * After recover event is executed after entity is being recovered in the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastAfterRecoverEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entity?: ObjectLiteral,
    databaseEntity?: ObjectLiteral,
    identifier?: ObjectLiteral
  ): void {
    if (entity && metadata.afterRecoverListeners.length) {
      metadata.afterRecoverListeners.forEach((listener) => {
        if (listener.isAllowed(entity)) {
          const executionResult = listener.execute(entity);
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }

    if (this.queryRunner.connection.subscribers.length) {
      this.queryRunner.connection.subscribers.forEach((subscriber) => {
        if (
          this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
          subscriber.afterRecover
        ) {
          const executionResult = subscriber.afterRecover({
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
            entity: entity,
            metadata: metadata,
            databaseEntity: databaseEntity,
            entityId: metadata.getEntityIdMixedMap(
              databaseEntity ?? identifier
            ),
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        }
      });
    }
  }

  /**
   * @deprecated Use `broadcastLoadForAllEvent`
   */
  public broadcastLoadEventsForAll(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entities: Array<ObjectLiteral>
  ): void {
    return this.broadcastLoadEvent(result, metadata, entities);
  }

  /**
   * Broadcasts "AFTER_LOAD" event for all given entities, and their sub-entities.
   * After load event is executed after entity has been loaded from the database.
   * All subscribers and entity listeners who listened to this event will be executed at this point.
   * Subscribers and entity listeners can return promises, it will wait until they are resolved.
   *
   * Note: this method has a performance-optimized code organization, do not change code structure.
   */
  public broadcastLoadEvent(
    result: BroadcasterResult,
    metadata: EntityMetadata,
    entities: Array<ObjectLiteral>
  ): void {
    // Calculate which subscribers are fitting for the given entity type
    const fittingSubscribers = this.queryRunner.connection.subscribers.filter(
      (subscriber) =>
        this.isAllowedSubscriber(subscriber, metadata.target as TFunction) &&
        subscriber.afterLoad
    );

    if (
      metadata.relations.length ||
      metadata.afterLoadListeners.length ||
      fittingSubscribers.length
    ) {
      // todo: check why need this?
      const nonPromiseEntities = entities.filter(
        (entity) => !(entity instanceof Promise)
      );

      // collect load events for all children entities that were loaded with the main entity
      if (metadata.relations.length) {
        metadata.relations.forEach((relation) => {
          nonPromiseEntities.forEach((entity) => {
            // in lazy relations we cannot simply access to entity property because it will cause a getter and a database query
            if (
              relation.isLazy &&
              !Object.prototype.hasOwnProperty.call(
                entity,
                relation.propertyName
              )
            )
              return;

            const value = relation.getEntityValue(entity);
            if (ObjectUtils.isObject(value))
              this.broadcastLoadEvent(
                result,
                relation.inverseEntityMetadata,
                Array.isArray(value) ? value : [value]
              );
          });
        });
      }

      if (metadata.afterLoadListeners.length) {
        metadata.afterLoadListeners.forEach((listener) => {
          nonPromiseEntities.forEach((entity) => {
            if (listener.isAllowed(entity)) {
              const executionResult = listener.execute(entity);
              if (executionResult instanceof Promise)
                result.promises.push(executionResult);
              result.count++;
            }
          });
        });
      }

      fittingSubscribers.forEach((subscriber) => {
        nonPromiseEntities.forEach((entity) => {
          const executionResult = subscriber.afterLoad!(entity, {
            entity,
            metadata,
            connection: this.queryRunner.connection,
            queryRunner: this.queryRunner,
            manager: this.queryRunner.manager,
          });
          if (executionResult instanceof Promise)
            result.promises.push(executionResult);
          result.count++;
        });
      });
    }
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Checks if subscriber's methods can be executed by checking if its don't listen to the particular entity,
   * or listens our entity.
   */
  protected isAllowedSubscriber(
    subscriber: EntitySubscriberInterface<unknown>,
    target: () => unknown | string
  ): boolean {
    return (
      !subscriber.listenTo ||
      !subscriber.listenTo() ||
      subscriber.listenTo() === Object ||
      subscriber.listenTo() === target ||
      Object.prototype.isPrototypeOf.call(subscriber.listenTo(), target)
    );
  }
}
