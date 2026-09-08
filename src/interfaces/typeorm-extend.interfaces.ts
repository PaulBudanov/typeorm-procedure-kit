import type { PrimaryGeneratedColumnNumericOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnNumericOptions.js';
import type { PrimaryGeneratedColumnUUIDOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnUUIDOptions.js';
import type { SelectQueryBuilder } from '../typeorm/query-builder/SelectQueryBuilder.js';
import type { Repository } from '../typeorm/repository/Repository.js';
import type {
  TRepositoryPropertyMap,
  TRepositoryPropertyPathsMap,
} from '../types/typeorm-extend.types.js';

export interface IRepositoryPropertyPathsMapRecord {
  [propertyName: string]:
    | string
    | IRepositoryPropertyPathsMapRecord
    | undefined;
  $path?: string;
}

export interface IRepositoryPropertyPathsMapNode extends IRepositoryPropertyPathsMapRecord {
  $path: string;
}

export interface IRepositoryContext<TEntity> {
  readonly propertyPaths: TRepositoryPropertyPathsMap<TEntity>;
  readonly property: TRepositoryPropertyMap<TEntity>;
  readonly repository: Repository<TEntity>;
}

export interface IBuildBaseQueryContext<
  TEntity,
> extends IRepositoryContext<TEntity> {
  readonly builder: SelectQueryBuilder<TEntity>;
  readonly alias: string;
}

export interface IPrimaryGeneratedColumnUuid {
  strategy?: 'uuid';
  options?: PrimaryGeneratedColumnUUIDOptions;
}

export interface IPrimaryGeneratedColumnNumeric {
  strategy?: 'increment';
  options?: PrimaryGeneratedColumnNumericOptions;
}

export interface IRepositoryPropertyMapRecord {
  [propertyName: string]: string | IRepositoryPropertyMapRecord | undefined;
  $path?: string;
}
