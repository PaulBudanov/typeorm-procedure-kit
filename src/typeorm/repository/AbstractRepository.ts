import type { EntityTarget } from '../common/EntityTarget.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { ObjectType } from '../common/ObjectType.js';
import type { EntityManager } from '../entity-manager/EntityManager.js';
import { CustomRepositoryDoesNotHaveEntityError } from '../error/CustomRepositoryDoesNotHaveEntityError.js';
import { CustomRepositoryNotFoundError } from '../error/CustomRepositoryNotFoundError.js';
import { getMetadataArgsStorage } from '../globals.js';
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';

import type { Repository } from './Repository.js';
import type { TreeRepository } from './TreeRepository.js';

/**
 * Provides abstract class for custom repositories that do not inherit from original orm Repository.
 * Contains all most-necessary methods to simplify code in the custom repository.
 * All methods are protected thus not exposed and it allows to create encapsulated custom repository.
 *
 * @deprecated use Repository.extend function to create a custom repository
 */
export class AbstractRepository<Entity = unknown> {
  // -------------------------------------------------------------------------
  // Protected Methods Set Dynamically
  // -------------------------------------------------------------------------

  /**
   * Gets entity manager that allows to perform repository operations with any entity.
   */
  protected manager!: EntityManager;

  // -------------------------------------------------------------------------
  // Protected Accessors
  // -------------------------------------------------------------------------

  /**
   * Gets the original ORM repository for the entity that is managed by this repository.
   * If current repository does not manage any entity, then exception will be thrown.
   */
  protected get repository(): Repository<Entity> {
    const target = this.getCustomRepositoryTarget(this as unknown);
    if (!target)
      throw new CustomRepositoryDoesNotHaveEntityError(this.constructor);

    return this.manager.getRepository<Entity>(target as EntityTarget<Entity>);
  }

  /**
   * Gets the original ORM tree repository for the entity that is managed by this repository.
   * If current repository does not manage any entity, then exception will be thrown.
   */
  protected get treeRepository(): TreeRepository<ObjectLiteral> {
    const target = this.getCustomRepositoryTarget(this as unknown);
    if (!target)
      throw new CustomRepositoryDoesNotHaveEntityError(this.constructor);

    return this.manager.getTreeRepository<ObjectLiteral>(
      target as EntityTarget<ObjectLiteral>
    ) as TreeRepository<ObjectLiteral>;
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new query builder for the repository's entity that can be used to build a SQL query.
   * If current repository does not manage any entity, then exception will be thrown.
   */
  protected createQueryBuilder(
    alias: string
  ): SelectQueryBuilder<Entity extends ObjectLiteral ? Entity : ObjectLiteral> {
    const target = this.getCustomRepositoryTarget(this.constructor);
    if (!target)
      throw new CustomRepositoryDoesNotHaveEntityError(this.constructor);

    return this.manager
      .getRepository<Entity>(target as EntityTarget<Entity>)
      .createQueryBuilder(alias);
  }

  /**
   * Creates a new query builder for the given entity that can be used to build a SQL query.
   */
  protected createQueryBuilderFor<T extends ObjectLiteral>(
    entity: ObjectType<T>,
    alias: string
  ): SelectQueryBuilder<T> {
    return this.getRepositoryFor(entity).createQueryBuilder(
      alias
    ) as SelectQueryBuilder<T>;
  }

  /**
   * Gets the original ORM repository for the given entity class.
   */
  protected getRepositoryFor<T extends ObjectLiteral>(
    entity: ObjectType<T>
  ): Repository<T> {
    return this.manager.getRepository(entity);
  }

  /**
   * Gets the original ORM tree repository for the given entity class.
   */
  protected getTreeRepositoryFor<T extends ObjectLiteral>(
    entity: ObjectType<T>
  ): TreeRepository<T> {
    return this.manager.getTreeRepository(entity);
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  /**
   * Gets custom repository's managed entity.
   * If given custom repository does not manage any entity then undefined will be returned.
   */
  private getCustomRepositoryTarget(
    customRepository: unknown
  ): EntityTarget<unknown> | undefined {
    const entityRepositoryMetadataArgs =
      getMetadataArgsStorage().entityRepositories.find((repository) => {
        return (
          repository.target ===
          (typeof customRepository === 'function'
            ? customRepository
            : (customRepository as object).constructor)
        );
      });
    if (!entityRepositoryMetadataArgs)
      throw new CustomRepositoryNotFoundError(customRepository as object);

    return entityRepositoryMetadataArgs.entity;
  }
}
