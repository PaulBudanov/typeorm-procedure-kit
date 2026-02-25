import { getMetadataArgsStorage } from '../../globals.js';
import type { ColumnMetadataArgs } from '../../metadata-args/ColumnMetadataArgs.js';

/**
 * Creates a "level"/"length" column to the table that holds a closure table.
 */
export function TreeLevelColumn(): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    getMetadataArgsStorage().columns.push({
      target: object.constructor,
      propertyName: propertyName.toString(),
      mode: 'treeLevel',
      options: {},
    } as ColumnMetadataArgs);
  };
}
