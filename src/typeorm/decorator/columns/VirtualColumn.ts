import type { TFunction } from '../../../types/utility.types.js';
import type { ColumnType } from '../../driver/types/ColumnTypes.js';
import { ColumnTypeUndefinedError } from '../../error/ColumnTypeUndefinedError.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';
import type { VirtualColumnOptions } from '../options/VirtualColumnOptions.js';

/**
 * VirtualColumn decorator is used to mark a specific class property as a Virtual column.
 */
export function VirtualColumn(options: VirtualColumnOptions): PropertyDecorator;

/**
 * VirtualColumn decorator is used to mark a specific class property as a Virtual column.
 */
export function VirtualColumn(
  typeOrOptions: ColumnType,
  options: VirtualColumnOptions
): PropertyDecorator;

/**
 * VirtualColumn decorator is used to mark a specific class property as a Virtual column.
 */
export function VirtualColumn(
  typeOrOptions?: ColumnType | VirtualColumnOptions,
  options?: VirtualColumnOptions
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    // normalize parameters
    let type: ColumnType | undefined;
    if (typeof typeOrOptions === 'string') {
      type = typeOrOptions as ColumnType;
    } else {
      options = typeOrOptions as VirtualColumnOptions;
      type = options.type;
    }

    if (!options?.query) {
      throw new Error('Column options must be defined for calculated columns.');
    }

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
    if (!type && reflectMetadataType)
      // if type is not given explicitly then try to guess it
      type = reflectMetadataType;

    // check if there is no type in column options then set type from first function argument, or guessed one
    if (type) options.type = type;

    // specify HSTORE type if column is HSTORE
    if (options.type === 'hstore' && !options.hstoreType)
      options.hstoreType = 'string';

    // if we still don't have a type then we need to give error to user that type is required
    if (!options.type)
      throw new ColumnTypeUndefinedError(object, propertyName.toString());

    getMetadataArgsStorage().columns.push({
      target: object.constructor,
      propertyName: propertyName.toString(),
      mode: 'virtual-property',
      options: options ?? {},
    } as ColumnMetadataArgs);
  };
}
