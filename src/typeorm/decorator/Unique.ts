import { getMetadataArgsStorage } from '../globals.js';
import type { UniqueMetadataArgs } from '../metadata-args/UniqueMetadataArgs.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import type { UniqueOptions } from './options/UniqueOptions.js';

type FieldsFunction = (
  object?: unknown
) => Array<unknown> | Record<string, number>;

// Type alias to avoid ESLint no-unsafe-function-type
type AnyFunction = (...args: Array<unknown>) => unknown;

/**
 * Composite unique constraint must be set on entity classes and must specify entity's fields to be unique.
 */
export function Unique(
  name: string,
  fields: Array<string>,
  options?: UniqueOptions
): ClassDecorator & PropertyDecorator;

/**
 * Composite unique constraint must be set on entity classes and must specify entity's fields to be unique.
 */
export function Unique(
  fields: Array<string>,
  options?: UniqueOptions
): ClassDecorator & PropertyDecorator;

/**
 * Composite unique constraint must be set on entity classes and must specify entity's fields to be unique.
 */
export function Unique(
  fields: FieldsFunction,
  options?: UniqueOptions
): ClassDecorator & PropertyDecorator;

/**
 * Composite unique constraint must be set on entity classes and must specify entity's fields to be unique.
 */
export function Unique(
  name: string,
  fields: FieldsFunction,
  options?: UniqueOptions
): ClassDecorator & PropertyDecorator;

/**
 * Composite unique constraint must be set on entity classes and must specify entity's fields to be unique.
 */
export function Unique(
  nameOrFieldsOrOptions?:
    | string
    | Array<string>
    | FieldsFunction
    | UniqueOptions,
  maybeFieldsOrOptions?: FieldsFunction | Array<string> | UniqueOptions,
  maybeOptions?: UniqueOptions
): ClassDecorator & PropertyDecorator {
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
      ? (nameOrFieldsOrOptions as UniqueOptions)
      : maybeOptions;
  if (!options)
    options =
      ObjectUtils.isObject(nameOrFieldsOrOptions) &&
      !Array.isArray(maybeFieldsOrOptions)
        ? (maybeFieldsOrOptions as UniqueOptions)
        : maybeOptions;

  return function <T extends AnyFunction | object>(
    clsOrObject: T,
    propertyName?: string | symbol
  ): void {
    let columns = fields;

    if (propertyName !== undefined) {
      switch (typeof propertyName) {
        case 'string':
          columns = [propertyName];
          break;

        case 'symbol':
          columns = [propertyName.toString()];
          break;
      }
    }

    getMetadataArgsStorage().uniques.push({
      target: propertyName
        ? (clsOrObject.constructor as unknown)
        : (clsOrObject as unknown),
      name: name,
      columns,
      deferrable: options ? options.deferrable : undefined,
    } as unknown as UniqueMetadataArgs);
  };
}
