import type { ObjectLiteral } from '../../common/ObjectLiteral.js';

export type EntityPropertyMapLeaf = string;

export interface EntityPropertiesMapRecord {
  [propertyName: string]: EntityPropertyMapLeaf | EntityPropertiesMapRecord;
}

export type EntityDatabasePropertyMapLeaf = string;

export interface EntityDatabasePropertiesMapRecord {
  [propertyName: string]:
    | EntityDatabasePropertyMapLeaf
    | EntityDatabasePropertiesMapRecord;
}

type EntityPropertyScalar =
  | Date
  | RegExp
  | Uint8Array
  | ((...args: Array<unknown>) => unknown);

type EntityPropertyValueMap<T> =
  NonNullable<Awaited<T>> extends ReadonlyArray<infer Item>
    ? EntityPropertiesMap<Item>
    : NonNullable<Awaited<T>> extends EntityPropertyScalar
      ? EntityPropertyMapLeaf
      : NonNullable<Awaited<T>> extends object
        ? EntityPropertiesMap<NonNullable<Awaited<T>>>
        : EntityPropertyMapLeaf;

type EntityDatabasePropertyValueMap<T> =
  NonNullable<Awaited<T>> extends ReadonlyArray<infer Item>
    ? EntityDatabasePropertiesMap<Item>
    : NonNullable<Awaited<T>> extends EntityPropertyScalar
      ? EntityDatabasePropertyMapLeaf
      : NonNullable<Awaited<T>> extends object
        ? EntityDatabasePropertiesMap<NonNullable<Awaited<T>>>
        : EntityDatabasePropertyMapLeaf;

export type EntityPropertiesMap<T = ObjectLiteral> = string extends keyof T
  ? EntityPropertiesMapRecord
  : {
      readonly [Property in keyof T & string]: EntityPropertyValueMap<
        T[Property]
      >;
    };

export type EntityDatabasePropertiesMap<T = ObjectLiteral> =
  string extends keyof T
    ? EntityDatabasePropertiesMapRecord
    : {
        readonly [Property in keyof T & string]: EntityDatabasePropertyValueMap<
          T[Property]
        >;
      };
