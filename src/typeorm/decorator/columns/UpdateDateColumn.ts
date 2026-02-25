import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';
import type { ColumnOptions } from '../options/ColumnOptions.js';

/**
 * This column will store an update date of the updated object.
 * This date is being updated each time you persist the object.
 */
export function UpdateDateColumn(options?: ColumnOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    getMetadataArgsStorage().columns.push({
      target: object.constructor,
      propertyName: propertyName.toString(),
      mode: 'updateDate',
      options: options ?? {},
    } as ColumnMetadataArgs);
  };
}
