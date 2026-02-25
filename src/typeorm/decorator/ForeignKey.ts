import type { ObjectType } from '../common/ObjectType.js';
import { getMetadataArgsStorage } from '../globals.js';
import type { ForeignKeyMetadataArgs } from '../metadata-args/ForeignKeyMetadataArgs.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import type { ForeignKeyOptions } from './options/ForeignKeyOptions.js';

type TypeFunction<T> = (type?: unknown) => ObjectType<T>;
type InverseSideFunction<T> = (object: T) => unknown;

/**
 * Creates a database foreign key. Can be used on entity property or on entity.
 * Can create foreign key with composite columns when used on entity.
 * Warning! Don't use this with relations; relation decorators create foreign keys automatically.
 */
export function ForeignKey<T>(
  typeOrTarget: string | TypeFunction<T>,
  options?: ForeignKeyOptions
): PropertyDecorator;

/**
 * Creates a database foreign key. Can be used on entity property or on entity.
 * Can create foreign key with composite columns when used on entity.
 * Warning! Don't use this with relations; relation decorators create foreign keys automatically.
 */
export function ForeignKey<T>(
  typeOrTarget: string | TypeFunction<T>,
  inverseSide: string | InverseSideFunction<T>,
  options?: ForeignKeyOptions
): PropertyDecorator;

/**
 * Creates a database foreign key. Can be used on entity property or on entity.
 * Can create foreign key with composite columns when used on entity.
 * Warning! Don't use this with relations; relation decorators create foreign keys automatically.
 */
export function ForeignKey<
  T,
  C extends (readonly [] | ReadonlyArray<string>) &
    (number extends C['length'] ? readonly [] : unknown),
>(
  typeOrTarget: string | TypeFunction<T>,
  columnNames: C,
  referencedColumnNames: { [K in keyof C]: string },
  options?: ForeignKeyOptions
): ClassDecorator;

/**
 * Creates a database foreign key. Can be used on entity property or on entity.
 * Can create foreign key with composite columns when used on entity.
 * Warning! Don't use this with relations; relation decorators create foreign keys automatically.
 */
export function ForeignKey<
  T,
  C extends (readonly [] | ReadonlyArray<string>) &
    (number extends C['length'] ? readonly [] : unknown),
>(
  typeOrTarget: string | TypeFunction<T>,
  inverseSideOrColumnNamesOrOptions?:
    | string
    | InverseSideFunction<T>
    | C
    | ForeignKeyOptions,
  referencedColumnNamesOrOptions?:
    | { [K in keyof C]: string }
    | ForeignKeyOptions,
  maybeOptions?: ForeignKeyOptions
): ClassDecorator & PropertyDecorator {
  const inverseSide =
    typeof inverseSideOrColumnNamesOrOptions === 'string' ||
    typeof inverseSideOrColumnNamesOrOptions === 'function'
      ? inverseSideOrColumnNamesOrOptions
      : undefined;

  const columnNames = Array.isArray(inverseSideOrColumnNamesOrOptions)
    ? inverseSideOrColumnNamesOrOptions
    : undefined;

  const referencedColumnNames = Array.isArray(referencedColumnNamesOrOptions)
    ? referencedColumnNamesOrOptions
    : undefined;

  const options =
    ObjectUtils.isObject(inverseSideOrColumnNamesOrOptions) &&
    !Array.isArray(inverseSideOrColumnNamesOrOptions)
      ? inverseSideOrColumnNamesOrOptions
      : ObjectUtils.isObject(referencedColumnNamesOrOptions) &&
          !Array.isArray(referencedColumnNamesOrOptions)
        ? referencedColumnNamesOrOptions
        : maybeOptions;

  return function (
    clsOrObject: ((...args: Array<unknown>) => unknown) | object,
    propertyName?: string | symbol
  ) {
    getMetadataArgsStorage().foreignKeys.push({
      target: propertyName
        ? clsOrObject.constructor
        : (clsOrObject as (...args: Array<unknown>) => unknown),
      propertyName: propertyName,
      type: typeOrTarget,
      inverseSide,
      columnNames,
      referencedColumnNames,
      ...(options as ForeignKeyOptions),
    } as ForeignKeyMetadataArgs);
  };
}
