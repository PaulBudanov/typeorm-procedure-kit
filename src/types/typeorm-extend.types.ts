import type {
  IPrimaryGeneratedColumnNumeric,
  IPrimaryGeneratedColumnUuid,
  IRepositoryPropertyMapRecord,
  IRepositoryPropertyPathsMapNode,
  IRepositoryPropertyPathsMapRecord,
} from '../interfaces/typeorm-extend.interfaces.js';
import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { DataSourceOptions } from '../typeorm/data-source/DataSourceOptions.js';
import type { PrimaryGeneratedColumnNumericOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnNumericOptions.js';
import type { PrimaryGeneratedColumnUUIDOptions } from '../typeorm/decorator/options/PrimaryGeneratedColumnUUIDOptions.js';

export type {
  IBuildBaseQueryContext,
  IRepositoryContext,
  IRepositoryPropertyMapRecord,
} from '../interfaces/typeorm-extend.interfaces.js';

export type TEntityTargets<TEntityTarget> = Readonly<
  Record<DataSourceOptions['type'], TEntityTarget>
>;

type TRepositoryPropertyMapScalar =
  | Date
  | RegExp
  | Uint8Array
  | ((...args: Array<unknown>) => unknown);

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

export type TEntityTargetFactory<TEntityTarget> = (
  dataSource: DataSource
) => TEntityTarget;

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
