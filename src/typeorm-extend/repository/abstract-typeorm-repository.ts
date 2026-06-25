import type { EntityTarget } from '../../typeorm/common/EntityTarget.js';
import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { ColumnMetadata } from '../../typeorm/metadata/ColumnMetadata.js';
import type { EntityMetadata } from '../../typeorm/metadata/EntityMetadata.js';
import type { Repository } from '../../typeorm/repository/Repository.js';
import type {
  IBuildBaseQueryContext,
  IEntityTargets,
  IRepositoryContext,
  TRepositoryPropertyMap,
  TRepositoryPropertyPathsMap,
  TEntityTargetFactory,
  IRepositoryPropertyMapRecord,
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
  private static readonly propertyPathsMapCache = new WeakMap<
    object,
    IRepositoryPropertyMapRecord
  >();

  private static readonly propertyMapCache = new WeakMap<
    object,
    IRepositoryPropertyMapRecord
  >();

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
      propertyPaths: this.getPropertyPathsMap<TEntity, TEntity>(
        repository.metadata
      ),
      property: this.getPropertyMap<TEntity, TEntity>(repository.metadata),
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

  private getPropertyPathsMap<TMapEntity, TMetadataEntity>(
    metadata: EntityMetadata<TMetadataEntity>
  ): TRepositoryPropertyPathsMap<TMapEntity> {
    let map = AbstractTypeormRepository.propertyPathsMapCache.get(metadata);
    if (!map) {
      map = this.buildRepositoryPropertyMap(metadata, {
        includeRelationPath: true,
        pathPrefix: '',
        getColumnValue: (column, pathPrefix) =>
          this.joinPropertyPath(pathPrefix, column.propertyPath),
      });
      AbstractTypeormRepository.propertyPathsMapCache.set(metadata, map);
    }

    return map as TRepositoryPropertyPathsMap<TMapEntity>;
  }

  private getPropertyMap<TMapEntity, TMetadataEntity>(
    metadata: EntityMetadata<TMetadataEntity>
  ): TRepositoryPropertyMap<TMapEntity> {
    let map = AbstractTypeormRepository.propertyMapCache.get(metadata);
    if (!map) {
      map = this.buildRepositoryPropertyMap(metadata, {
        includeRelationPath: false,
        pathPrefix: '',
        getColumnValue: (column) =>
          column.isVirtual && column.relationMetadata
            ? undefined
            : column.databasePath,
      });
      AbstractTypeormRepository.propertyMapCache.set(metadata, map);
    }

    return map as TRepositoryPropertyMap<TMapEntity>;
  }

  private buildRepositoryPropertyMap<TMetadataEntity>(
    metadata: EntityMetadata<TMetadataEntity>,
    options: {
      readonly includeRelationPath: boolean;
      readonly pathPrefix: string;
      readonly getColumnValue: (
        column: ColumnMetadata,
        pathPrefix: string
      ) => string | undefined;
    },
    visitedMetadatas: ReadonlySet<object> = new Set()
  ): IRepositoryPropertyMapRecord {
    const map: IRepositoryPropertyMapRecord = {};
    const nextVisitedMetadatas = new Set(visitedMetadatas);
    nextVisitedMetadatas.add(metadata);

    for (const column of metadata.columns) {
      const columnValue = options.getColumnValue(column, options.pathPrefix);
      if (columnValue !== undefined) {
        this.setMapValue(map, column.propertyPath, columnValue);
      }
    }

    for (const relation of metadata.relations) {
      const relationPath = this.joinPropertyPath(
        options.pathPrefix,
        relation.propertyPath
      );

      if (visitedMetadatas.has(relation.inverseEntityMetadata)) {
        if (options.includeRelationPath) {
          this.setMapValue(map, relation.propertyPath, relationPath);
        }
        continue;
      }

      const relationSlot = this.getOrCreateMapRecord(
        map,
        relation.propertyPath
      );
      if (options.includeRelationPath) {
        relationSlot.$path = relationPath;
      }

      this.mergeMap(
        relationSlot,
        this.buildRepositoryPropertyMap(
          relation.inverseEntityMetadata,
          {
            ...options,
            pathPrefix: options.includeRelationPath ? relationPath : '',
          },
          nextVisitedMetadatas
        )
      );
    }

    return map;
  }

  private joinPropertyPath(pathPrefix: string, propertyPath: string): string {
    if (pathPrefix.length === 0) return propertyPath;

    return `${pathPrefix}.${propertyPath}`;
  }

  private getOrCreateMapRecord(
    map: IRepositoryPropertyMapRecord,
    propertyPath: string
  ): IRepositoryPropertyMapRecord {
    let currentMap = map;

    for (const pathSegment of propertyPath.split('.')) {
      const existingValue = currentMap[pathSegment];

      if (this.isMapRecord(existingValue)) {
        currentMap = existingValue;
        continue;
      }

      const nextMap: IRepositoryPropertyMapRecord = {};
      currentMap[pathSegment] = nextMap;
      currentMap = nextMap;
    }

    return currentMap;
  }

  private setMapValue(
    map: IRepositoryPropertyMapRecord,
    propertyPath: string,
    value: string
  ): void {
    const pathSegments = propertyPath.split('.');
    const leafProperty = pathSegments.pop();
    if (leafProperty === undefined) return;

    let currentMap = map;
    for (const pathSegment of pathSegments) {
      currentMap = this.getOrCreateMapRecord(currentMap, pathSegment);
    }

    currentMap[leafProperty] = value;
  }

  private mergeMap(
    targetMap: IRepositoryPropertyMapRecord,
    sourceMap: IRepositoryPropertyMapRecord
  ): void {
    for (const [propertyName, sourceValue] of Object.entries(sourceMap)) {
      const targetValue = targetMap[propertyName];

      if (this.isMapRecord(targetValue) && this.isMapRecord(sourceValue)) {
        this.mergeMap(targetValue, sourceValue);
        continue;
      }

      targetMap[propertyName] = sourceValue;
    }
  }

  private isMapRecord(
    value: string | IRepositoryPropertyMapRecord | undefined
  ): value is IRepositoryPropertyMapRecord {
    return typeof value === 'object' && value !== null;
  }
}
