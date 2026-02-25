import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';
import type { GeneratedMetadataArgs } from '../../metadata-args/GeneratedMetadataArgs.js';
import { ObjectUtils } from '../../util/ObjectUtils.js';
import type { ColumnOptions } from '../options/ColumnOptions.js';
import type { PrimaryGeneratedColumnNumericOptions } from '../options/PrimaryGeneratedColumnNumericOptions.js';
import type { PrimaryGeneratedColumnUUIDOptions } from '../options/PrimaryGeneratedColumnUUIDOptions.js';

/**
 * Column decorator is used to mark a specific class property as a table column.
 */
export function PrimaryGeneratedColumn(): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 */
export function PrimaryGeneratedColumn(
  options: PrimaryGeneratedColumnNumericOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 */
export function PrimaryGeneratedColumn(
  strategy: 'increment',
  options?: PrimaryGeneratedColumnNumericOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 */
export function PrimaryGeneratedColumn(
  strategy: 'uuid',
  options?: PrimaryGeneratedColumnUUIDOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 * This column creates an integer PRIMARY COLUMN with generated set to true.
 */
export function PrimaryGeneratedColumn(
  strategyOrOptions?:
    | 'increment'
    | 'uuid'
    | PrimaryGeneratedColumnNumericOptions
    | PrimaryGeneratedColumnUUIDOptions,
  maybeOptions?:
    | PrimaryGeneratedColumnNumericOptions
    | PrimaryGeneratedColumnUUIDOptions
): PropertyDecorator {
  // normalize parameters
  const options: ColumnOptions = {};
  let strategy: 'increment' | 'uuid';
  if (strategyOrOptions) {
    if (typeof strategyOrOptions === 'string')
      strategy = strategyOrOptions as 'increment' | 'uuid';

    if (ObjectUtils.isObject(strategyOrOptions)) {
      strategy = 'increment';
      Object.assign(options, strategyOrOptions);
    }
  } else {
    strategy = 'increment';
  }
  if (ObjectUtils.isObject(maybeOptions)) Object.assign(options, maybeOptions);

  return function (object: object, propertyName: string | symbol): void {
    // if column type is not explicitly set then determine it based on generation strategy
    if (!options.type) {
      if (strategy === 'increment') {
        options.type = Number;
      } else if (strategy === 'uuid') {
        options.type = 'uuid';
      }
    }

    // explicitly set a primary and generated to column options
    options.primary = true;

    // register column metadata args
    getMetadataArgsStorage().columns.push({
      target: object.constructor as unknown,
      propertyName: propertyName.toString(),
      mode: 'regular',
      options: options,
    } as unknown as ColumnMetadataArgs);

    // register generated metadata args
    getMetadataArgsStorage().generations.push({
      target: object.constructor as unknown,
      propertyName: propertyName.toString(),
      strategy: strategy,
    } as unknown as GeneratedMetadataArgs);
  };
}
