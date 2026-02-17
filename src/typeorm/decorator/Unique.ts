import { getMetadataArgsStorage } from '../globals';
import { UniqueMetadataArgs } from '../metadata-args/UniqueMetadataArgs';
import { ObjectUtils } from '../util/ObjectUtils';

import { UniqueOptions } from './options/UniqueOptions';

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
  fields: (object?: any) => Array<any> | Record<string, number>,
  options?: UniqueOptions
): ClassDecorator & PropertyDecorator;

/**
 * Composite unique constraint must be set on entity classes and must specify entity's fields to be unique.
 */
export function Unique(
  name: string,
  fields: (object?: any) => Array<any> | Record<string, number>,
  options?: UniqueOptions
): ClassDecorator & PropertyDecorator;

/**
 * Composite unique constraint must be set on entity classes and must specify entity's fields to be unique.
 */
export function Unique(
  nameOrFieldsOrOptions?:
    | string
    | Array<string>
    | ((object: any) => Array<any> | Record<string, number>)
    | UniqueOptions,
  maybeFieldsOrOptions?:
    | ((object?: any) => Array<any> | Record<string, number>)
    | Array<string>
    | UniqueOptions,
  maybeOptions?: UniqueOptions
): ClassDecorator & PropertyDecorator {
  const name =
    typeof nameOrFieldsOrOptions === 'string'
      ? nameOrFieldsOrOptions
      : undefined;
  const fields =
    typeof nameOrFieldsOrOptions === 'string'
      ? (maybeFieldsOrOptions as
          | ((object?: any) => Array<any> | Record<string, number>)
          | Array<string>)
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

  return function (
    clsOrObject: Function | object,
    propertyName?: string | symbol
  ) {
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

    const args: UniqueMetadataArgs = {
      target: propertyName
        ? clsOrObject.constructor
        : (clsOrObject as Function),
      name: name,
      columns,
      deferrable: options ? options.deferrable : undefined,
    };
    getMetadataArgsStorage().uniques.push(args);
  };
}
