import type { EntityTarget } from '../../typeorm/common/EntityTarget.js';
import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { Repository } from '../../typeorm/repository/Repository.js';
import type {
  IBuildBaseQueryContext,
  IEntityTargets,
  IRepositoryContext,
  TEntityTargetFactory,
} from '../../types/typeorm-extend.types.js';

/**
 * Base repository helper for projects that keep database-specific entity targets.
 *
 * The class resolves the target from the active DataSource, exposes the regular
 * TypeORM repository, and provides database property names for manual query
 * fragments through EntityMetadata.databasePropertiesMap.
 */
export abstract class AbstractTypeormRepository<
  TEntity,
  TEntityTarget extends EntityTarget<TEntity>,
> {
  private entityTarget: TEntityTarget | null = null;

  /**
   * Creates an entity target factory keyed by DataSourceOptions.type.
   */
  public static createEntityTargetFactory<TEntityTarget>(
    entityTargets: IEntityTargets<TEntityTarget>
  ): TEntityTargetFactory<TEntityTarget> {
    return (dataSource: DataSource): TEntityTarget =>
      entityTargets[dataSource.options.type];
  }

  public constructor(
    private readonly getDataSource: () => DataSource,
    private readonly getEntityTargetFactory: TEntityTargetFactory<TEntityTarget>
  ) {}

  private get dataSource(): DataSource {
    return this.getDataSource();
  }

  /**
   * Returns the entity target for the current DataSource and caches it for the repository instance.
   */
  protected getEntityTarget(): TEntityTarget {
    if (this.entityTarget !== null) return this.entityTarget;

    this.entityTarget = this.getEntityTargetFactory(this.dataSource);

    return this.entityTarget;
  }

  /**
   * Returns a TypeORM repository for the resolved entity target.
   */
  protected getRepository(manager?: EntityManager): Repository<TEntity> {
    const entityTarget = this.getEntityTarget();

    if (manager !== undefined) return manager.getRepository(entityTarget);

    return this.dataSource.getRepository(entityTarget);
  }

  /**
   * Returns the repository together with database property names from entity metadata.
   */
  protected getRepositoryContext(
    manager?: EntityManager
  ): IRepositoryContext<TEntity> {
    const repository = this.getRepository(manager);

    return {
      property: repository.metadata.databasePropertiesMap,
      repository,
    };
  }

  /**
   * Builds a query builder context for repository methods that assemble SQL fragments manually.
   */
  protected buildBaseQueryContext(
    alias: string,
    manager?: EntityManager
  ): IBuildBaseQueryContext<TEntity> {
    const { property, repository } = this.getRepositoryContext(manager);

    return {
      builder: repository.createQueryBuilder(alias),
      property,
      repository,
      alias,
    };
  }
}
