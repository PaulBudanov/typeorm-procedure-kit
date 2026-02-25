import { getMetadataArgsStorage } from '../globals.js';
import type { IndexMetadataArgs } from '../metadata-args/IndexMetadataArgs.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import type { IndexOptions } from './options/IndexOptions.js';

type FieldsFunction = (
  object?: unknown
) => Array<unknown> | Record<string, number>;

/**
 * Creates a database index.
 * Can be used on entity property or on entity.
 * Can create indices with composite columns when used on entity.
 */
export function Index(
  options?: IndexOptions
): ClassDecorator & PropertyDecorator;

/**
 * Creates a database index.
 * Can be used on entity property or on entity.
 * Can create indices with composite columns when used on entity.
 */
export function Index(
  name: string,
  options?: IndexOptions
): ClassDecorator & PropertyDecorator;

/**
 * Creates a database index.
 * Can be used on entity property or on entity.
 * Can create indices with composite columns when used on entity.
 */
export function Index(
  name: string,
  options: { synchronize: false }
): ClassDecorator & PropertyDecorator;

/**
 * Creates a database index.
 * Can be used on entity property or on entity.
 * Can create indices with composite columns when used on entity.
 */
export function Index(
  name: string,
  fields: Array<string>,
  options?: IndexOptions
): ClassDecorator & PropertyDecorator;

/**
 * Creates a database index.
 * Can be used on entity property or on entity.
 * Can create indices with composite columns when used on entity.
 */
export function Index(
  fields: FieldsFunction,
  options?: IndexOptions
): ClassDecorator & PropertyDecorator;

/**
 * Creates a database index.
 * Can be used on entity property or on entity.
 * Can create indices with composite columns when used on entity.
 */
export function Index(
  name: string,
  fields: FieldsFunction,
  options?: IndexOptions
): ClassDecorator & PropertyDecorator;

/**
 * Creates a database index.
 * Can be used on entity property or on entity.
 * Can create indices with composite columns when used on entity.
 */
export function Index(
  nameOrFieldsOrOptions?:
    | string
    | Array<string>
    | FieldsFunction
    | IndexOptions,
  maybeFieldsOrOptions?:
    | FieldsFunction
    | IndexOptions
    | Array<string>
    | { synchronize: false },
  maybeOptions?: IndexOptions
): ClassDecorator & PropertyDecorator {
  // normalize parameters
  const name =
    typeof nameOrFieldsOrOptions === 'string'
      ? nameOrFieldsOrOptions
      : undefined;
  const fields =
    typeof nameOrFieldsOrOptions === 'string'
      ? (maybeFieldsOrOptions as FieldsFunction | Array<string>)
      : (nameOrFieldsOrOptions as Array<string>);
  let options =
    ObjectUtils.isObject(nameOrFieldsOrOptions) &&
    !Array.isArray(nameOrFieldsOrOptions)
      ? (nameOrFieldsOrOptions as IndexOptions)
      : maybeOptions;
  if (!options)
    options =
      ObjectUtils.isObject(maybeFieldsOrOptions) &&
      !Array.isArray(maybeFieldsOrOptions)
        ? (maybeFieldsOrOptions as IndexOptions)
        : maybeOptions;

  return function (
    clsOrObject: ((...args: Array<unknown>) => unknown) | object,
    propertyName?: string | symbol
  ) {
    getMetadataArgsStorage().indices.push({
      target: propertyName
        ? clsOrObject.constructor
        : (clsOrObject as (...args: Array<unknown>) => unknown),
      name: name,
      columns: propertyName ? [propertyName] : fields,
      synchronize:
        options && (options as { synchronize: false }).synchronize === false
          ? false
          : true,
      where: options ? options.where : undefined,
      unique: options && options.unique ? true : false,
      spatial: options && options.spatial ? true : false,
      fulltext: options && options.fulltext ? true : false,
      nullFiltered: options && options.nullFiltered ? true : false,
      parser: options ? options.parser : undefined,
      sparse: options && options.sparse ? true : false,
      background: options && options.background ? true : false,
      concurrent: options && options.concurrent ? true : false,
      expireAfterSeconds: options ? options.expireAfterSeconds : undefined,
    } as IndexMetadataArgs);
  };
}
