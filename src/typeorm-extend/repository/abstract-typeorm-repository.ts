import type { EntityTarget } from '../../typeorm/common/EntityTarget.js';
import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { EntityMetadata } from '../../typeorm/metadata/EntityMetadata.js';
import type { Repository } from '../../typeorm/repository/Repository.js';
import type {
  IBuildBaseQueryContext,
  IEntityTargets,
  IRepositoryPropertyMapRecord,
  IRepositoryPropertyPathsMapRecord,
  IRepositoryContext,
  TRepositoryPropertyMap,
  TRepositoryPropertyPathsMap,
  TEntityTargetFactory,
} from '../../types/typeorm-extend.types.js';

/**
 * Base repository helper for projects that keep database-specific entity targets.
 *
 * The class resolves the target from the active DataSource, exposes the regular
 * TypeORM repository, and provides both TypeORM property paths and database
 * column names from entity metadata.
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
   * Returns the repository together with property path maps from entity metadata.
   */
  protected getRepositoryContext(
    manager?: EntityManager
  ): IRepositoryContext<TEntity> {
    const repository = this.getRepository(manager);

    return {
      propertyPaths: this.buildPropertyPathsMap<TEntity>(repository.metadata),
      property: this.buildPropertyMap<TEntity>(repository.metadata),
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
    const { property, propertyPaths, repository } =
      this.getRepositoryContext(manager);

    return {
      builder: repository.createQueryBuilder(alias),
      property,
      propertyPaths,
      repository,
      alias,
    };
  }

  private buildPropertyPathsMap<TMapEntity, TMetadataEntity = TMapEntity>(
    metadata: EntityMetadata<TMetadataEntity>,
    pathPrefix = '',
    visitedMetadatas: ReadonlySet<object> = new Set()
  ): TRepositoryPropertyPathsMap<TMapEntity> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const map: TRepositoryPropertyPathsMap<TMapEntity> = Object.create(
      Object.prototype
    );
    const nextVisitedMetadatas = new Set(visitedMetadatas);
    nextVisitedMetadatas.add(metadata);

    metadata.columns.forEach((column) => {
      this.setPropertyPathsMapValue(
        map,
        column.propertyPath,
        this.joinPropertyPath(pathPrefix, column.propertyPath)
      );
    });
    metadata.relations.forEach((relation) => {
      const relationPath = this.joinPropertyPath(
        pathPrefix,
        relation.propertyPath
      );

      if (visitedMetadatas.has(relation.inverseEntityMetadata)) {
        this.setPropertyPathsMapValue(map, relation.propertyPath, relationPath);
        return;
      }

      const relationMap = this.buildPropertyPathsMap(
        relation.inverseEntityMetadata,
        relationPath,
        nextVisitedMetadatas
      );
      const relationSlot = this.getOrCreatePropertyPathsMapRecord(
        map,
        relation.propertyPath
      );
      relationSlot.$path = relationPath;
      this.mergePropertyPathsMap(relationSlot, relationMap);
    });

    return map;
  }

  private buildPropertyMap<TMapEntity, TMetadataEntity = TMapEntity>(
    metadata: EntityMetadata<TMetadataEntity>,
    visitedMetadatas: ReadonlySet<object> = new Set()
  ): TRepositoryPropertyMap<TMapEntity> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const map: TRepositoryPropertyMap<TMapEntity> = Object.create(
      Object.prototype
    );
    const nextVisitedMetadatas = new Set(visitedMetadatas);
    nextVisitedMetadatas.add(metadata);

    metadata.columns.forEach((column) => {
      if (column.isVirtual && column.relationMetadata) return;

      this.setPropertyMapValue(map, column.propertyPath, column.databasePath);
    });
    metadata.relations.forEach((relation) => {
      if (visitedMetadatas.has(relation.inverseEntityMetadata)) return;

      const relationMap = this.buildPropertyMap(
        relation.inverseEntityMetadata,
        nextVisitedMetadatas
      );
      const relationSlot = this.getOrCreatePropertyMapRecord(
        map,
        relation.propertyPath
      );
      this.mergePropertyMap(relationSlot, relationMap);
    });

    return map;
  }

  private joinPropertyPath(pathPrefix: string, propertyPath: string): string {
    if (pathPrefix.length === 0) return propertyPath;

    return `${pathPrefix}.${propertyPath}`;
  }

  private getOrCreatePropertyPathsMapRecord(
    map: IRepositoryPropertyPathsMapRecord,
    propertyPath: string
  ): IRepositoryPropertyPathsMapRecord {
    const pathSegments = propertyPath.split('.');
    let currentMap = map;

    pathSegments.forEach((pathSegment) => {
      const existingValue = currentMap[pathSegment];

      if (this.isPropertyPathsMapRecord(existingValue)) {
        currentMap = existingValue;
        return;
      }

      const nextMap: IRepositoryPropertyPathsMapRecord = {};
      currentMap[pathSegment] = nextMap;
      currentMap = nextMap;
    });

    return currentMap;
  }

  private setPropertyPathsMapValue(
    map: IRepositoryPropertyPathsMapRecord,
    propertyPath: string,
    value: string
  ): void {
    const pathSegments = propertyPath.split('.');
    const leafProperty = pathSegments.pop();
    if (leafProperty === undefined) return;

    let currentMap = map;
    pathSegments.forEach((pathSegment) => {
      currentMap = this.getOrCreatePropertyPathsMapRecord(
        currentMap,
        pathSegment
      );
    });

    currentMap[leafProperty] = value;
  }

  private getOrCreatePropertyMapRecord(
    map: IRepositoryPropertyMapRecord,
    propertyPath: string
  ): IRepositoryPropertyMapRecord {
    const pathSegments = propertyPath.split('.');
    let currentMap = map;

    pathSegments.forEach((pathSegment) => {
      const existingValue = currentMap[pathSegment];

      if (this.isPropertyMapRecord(existingValue)) {
        currentMap = existingValue;
        return;
      }

      const nextMap: IRepositoryPropertyMapRecord = {};
      currentMap[pathSegment] = nextMap;
      currentMap = nextMap;
    });

    return currentMap;
  }

  private setPropertyMapValue(
    map: IRepositoryPropertyMapRecord,
    propertyPath: string,
    value: string
  ): void {
    const pathSegments = propertyPath.split('.');
    const leafProperty = pathSegments.pop();
    if (leafProperty === undefined) return;

    let currentMap = map;
    pathSegments.forEach((pathSegment) => {
      const existingValue = currentMap[pathSegment];

      if (this.isPropertyMapRecord(existingValue)) {
        currentMap = existingValue;
        return;
      }

      const nextMap: IRepositoryPropertyMapRecord = {};
      currentMap[pathSegment] = nextMap;
      currentMap = nextMap;
    });

    currentMap[leafProperty] = value;
  }

  private mergePropertyPathsMap(
    targetMap: IRepositoryPropertyPathsMapRecord,
    sourceMap: IRepositoryPropertyPathsMapRecord
  ): void {
    Object.entries(sourceMap).forEach(([propertyName, sourceValue]) => {
      const targetValue = targetMap[propertyName];

      if (
        this.isPropertyPathsMapRecord(targetValue) &&
        this.isPropertyPathsMapRecord(sourceValue)
      ) {
        this.mergePropertyPathsMap(targetValue, sourceValue);
        return;
      }

      targetMap[propertyName] = sourceValue;
    });
  }

  private mergePropertyMap(
    targetMap: IRepositoryPropertyMapRecord,
    sourceMap: IRepositoryPropertyMapRecord
  ): void {
    Object.entries(sourceMap).forEach(([propertyName, sourceValue]) => {
      const targetValue = targetMap[propertyName];

      if (
        this.isPropertyMapRecord(targetValue) &&
        this.isPropertyMapRecord(sourceValue)
      ) {
        this.mergePropertyMap(targetValue, sourceValue);
        return;
      }

      targetMap[propertyName] = sourceValue;
    });
  }

  private isPropertyPathsMapRecord(
    value: string | IRepositoryPropertyPathsMapRecord | undefined
  ): value is IRepositoryPropertyPathsMapRecord {
    return typeof value === 'object' && value !== null;
  }

  private isPropertyMapRecord(
    value: string | IRepositoryPropertyMapRecord | undefined
  ): value is IRepositoryPropertyMapRecord {
    return typeof value === 'object' && value !== null;
  }
}
