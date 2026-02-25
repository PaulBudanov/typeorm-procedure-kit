import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';
import type { ColumnOptions } from '../options/ColumnOptions.js';

/**
 * This column will store a creation date of the inserted object.
 * Creation date is generated and inserted only once,
 * at the first time when you create an object, the value is inserted into the table, and is never touched again.
 */
export function CreateDateColumn(options?: ColumnOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    getMetadataArgsStorage().columns.push({
      target: object.constructor,
      propertyName: propertyName.toString(),
      mode: 'createDate',
      options: options || {},
    } as ColumnMetadataArgs);
  };
}
