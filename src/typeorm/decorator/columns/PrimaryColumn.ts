import type { TFunction } from '../../../types/utility.types.js';
import type { ColumnType } from '../../driver/types/ColumnTypes.js';
import { PrimaryColumnCannotBeNullableError } from '../../error/PrimaryColumnCannotBeNullableError.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';
import type { GeneratedMetadataArgs } from '../../metadata-args/GeneratedMetadataArgs.js';
import type { ColumnOptions } from '../options/ColumnOptions.js';

/**
 * Describes all primary key column's options.
 * If specified, the nullable field must be set to false.
 */
export type PrimaryColumnOptions = ColumnOptions & { nullable?: false };

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 * Primary columns also creates a PRIMARY KEY for this column in a db.
 */
export function PrimaryColumn(
  options?: PrimaryColumnOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 * Primary columns also creates a PRIMARY KEY for this column in a db.
 */
export function PrimaryColumn(
  type?: ColumnType,
  options?: PrimaryColumnOptions
): PropertyDecorator;

/**
 * Column decorator is used to mark a specific class property as a table column.
 * Only properties decorated with this decorator will be persisted to the database when entity be saved.
 * Primary columns also creates a PRIMARY KEY for this column in a db.
 */
export function PrimaryColumn(
  typeOrOptions?: ColumnType | PrimaryColumnOptions,
  options?: PrimaryColumnOptions
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    // normalize parameters
    let type: ColumnType | undefined;
    if (
      typeof typeOrOptions === 'string' ||
      typeOrOptions === String ||
      typeOrOptions === Boolean ||
      typeOrOptions === Number
    ) {
      type = typeOrOptions as ColumnType;
    } else {
      options = Object.assign({}, typeOrOptions as PrimaryColumnOptions);
    }
    if (!options) options = {};

    // if type is not given explicitly then try to guess it
    const reflectMetadataType: ColumnType | undefined = (():
      | ColumnType
      | undefined => {
      if (!Reflect) return undefined;
      const reflect = Reflect as Record<string, TFunction>;
      if (typeof reflect.getMetadata !== 'function') return undefined;
      return reflect.getMetadata('design:type', object, propertyName) as
        | ColumnType
        | undefined;
    })();
    if (!type && reflectMetadataType) type = reflectMetadataType;

    // check if there is no type in column options then set type from first function argument, or guessed one
    if (!options.type && type) options.type = type;

    // check if column is not nullable, because we cannot allow a primary key to be nullable
    if (options.nullable)
      throw new PrimaryColumnCannotBeNullableError(
        object,
        propertyName.toString()
      );

    // explicitly set a primary to column options
    options.primary = true;

    // create and register a new column metadata
    getMetadataArgsStorage().columns.push({
      target: object.constructor,
      propertyName: propertyName.toString(),
      mode: 'regular',
      options: options,
    } as ColumnMetadataArgs);

    if (options.generated) {
      getMetadataArgsStorage().generations.push({
        target: object.constructor,
        propertyName: propertyName.toString(),
        strategy:
          typeof options.generated === 'string'
            ? options.generated
            : 'increment',
      } as GeneratedMetadataArgs);
    }
  };
}
