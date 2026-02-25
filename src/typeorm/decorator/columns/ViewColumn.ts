import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';
import type { ViewColumnOptions } from '../options/ViewColumnOptions.js';

/**
 * ViewColumn decorator is used to mark a specific class property as a view column.
 */
export function ViewColumn(options?: ViewColumnOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    getMetadataArgsStorage().columns.push({
      target: object.constructor,
      propertyName: propertyName.toString(),
      mode: 'regular',
      options: options ?? {},
    } as ColumnMetadataArgs);
  };
}
