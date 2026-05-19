import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { DataSourceOptions } from '../typeorm/data-source/DataSourceOptions.js';
import type { PrimaryGeneratedColumnNumericOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnNumericOptions.js';
import type { PrimaryGeneratedColumnUUIDOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnUUIDOptions.js';
import type { EntityDatabasePropertiesMap } from '../typeorm/metadata/types/EntityPropertiesMap.js';
import type { SelectQueryBuilder } from '../typeorm/query-builder/SelectQueryBuilder.js';
import type { Repository } from '../typeorm/repository/Repository.js';

export type IEntityTargets<TEntityTarget> = Readonly<
  Record<DataSourceOptions['type'], TEntityTarget>
>;

export interface IRepositoryContext<TEntity> {
  readonly property: EntityDatabasePropertiesMap<TEntity>;
  readonly repository: Repository<TEntity>;
}

export interface IBuildBaseQueryContext<
  TEntity,
> extends IRepositoryContext<TEntity> {
  readonly builder: SelectQueryBuilder<TEntity>;
  readonly alias: string;
}

export type TEntityTargetFactory<TEntityTarget> = (
  dataSource: DataSource
) => TEntityTarget;

interface IPrimaryGeneratedColumnUuid {
  strategy?: 'uuid';
  options?: PrimaryGeneratedColumnUUIDOptions;
}

interface IPrimaryGeneratedColumnNumeric {
  strategy?: 'increment';
  options?: PrimaryGeneratedColumnNumericOptions;
}

export type TExtendPrimaryGeneratedColumnOptions =
  | IPrimaryGeneratedColumnUuid
  | IPrimaryGeneratedColumnNumeric
  | PrimaryGeneratedColumnNumericOptions;

export type TPrimaryGeneratedColumnOverrideDescriptor =
  | {
      strategy?: 'increment';
      options?: PrimaryGeneratedColumnNumericOptions;
    }
  | {
      strategy?: 'uuid';
      options?: PrimaryGeneratedColumnUUIDOptions;
    };
