import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { DataSourceOptions } from '../typeorm/data-source/DataSourceOptions.js';
import type { PrimaryGeneratedColumnNumericOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnNumericOptions.js';
import type { PrimaryGeneratedColumnUUIDOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnUUIDOptions.js';
import type { SelectQueryBuilder } from '../typeorm/query-builder/SelectQueryBuilder.js';
import type { Repository } from '../typeorm/repository/Repository.js';

export type IEntityTargets<TEntityTarget> = Readonly<
  Record<DataSourceOptions['type'], TEntityTarget>
>;

type TRepositoryPropertyMapScalar =
  | Date
  | RegExp
  | Uint8Array
  | ((...args: Array<unknown>) => unknown);

export interface IRepositoryPropertyPathsMapRecord {
  [propertyName: string]:
    | string
    | IRepositoryPropertyPathsMapRecord
    | undefined;
  $path?: string;
}

export interface IRepositoryPropertyMapRecord {
  [propertyName: string]: string | IRepositoryPropertyMapRecord | undefined;
}

export interface IRepositoryPropertyPathsMapNode extends IRepositoryPropertyPathsMapRecord {
  $path: string;
}

type TRepositoryPropertyPathsValueMap<TValue> =
  NonNullable<Awaited<TValue>> extends TRepositoryPropertyMapScalar
    ? string
    : NonNullable<Awaited<TValue>> extends ReadonlyArray<infer Item>
      ? TRepositoryPropertyPathsMap<Item> & IRepositoryPropertyPathsMapNode
      : NonNullable<Awaited<TValue>> extends object
        ? TRepositoryPropertyPathsMap<NonNullable<Awaited<TValue>>> &
            IRepositoryPropertyPathsMapNode
        : string;

type TRepositoryPropertyValueMap<TValue> =
  NonNullable<Awaited<TValue>> extends TRepositoryPropertyMapScalar
    ? string
    : NonNullable<Awaited<TValue>> extends ReadonlyArray<infer Item>
      ? TRepositoryPropertyMap<Item>
      : NonNullable<Awaited<TValue>> extends object
        ? TRepositoryPropertyMap<NonNullable<Awaited<TValue>>>
        : string;

export type TRepositoryPropertyPathsMap<TEntity> = string extends keyof TEntity
  ? IRepositoryPropertyPathsMapRecord
  : IRepositoryPropertyPathsMapRecord & {
      [Property in keyof TEntity & string]: TRepositoryPropertyPathsValueMap<
        TEntity[Property]
      >;
    };

export type TRepositoryPropertyMap<TEntity> = string extends keyof TEntity
  ? IRepositoryPropertyMapRecord
  : IRepositoryPropertyMapRecord & {
      [Property in keyof TEntity & string]: TRepositoryPropertyValueMap<
        TEntity[Property]
      >;
    };

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
