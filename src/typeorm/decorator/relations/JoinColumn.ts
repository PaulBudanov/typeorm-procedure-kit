import type { TFunction } from '../../../types/utility.types.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { JoinColumnMetadataArgs } from '../../metadata-args/JoinColumnMetadataArgs.js';
import type { JoinColumnOptions } from '../options/JoinColumnOptions.js';

/**
 * JoinColumn decorator used on one-to-one relations to specify owner side of relationship.
 * It also can be used on both one-to-one and many-to-one relations to specify custom column name
 * or custom referenced column.
 */
export function JoinColumn(): PropertyDecorator;

/**
 * JoinColumn decorator used on one-to-one relations to specify owner side of relationship.
 * It also can be used on both one-to-one and many-to-one relations to specify custom column name
 * or custom referenced column.
 */
export function JoinColumn(options: JoinColumnOptions): PropertyDecorator;

/**
 * JoinColumn decorator used on one-to-one relations to specify owner side of relationship.
 * It also can be used on both one-to-one and many-to-one relations to specify custom column name
 * or custom referenced column.
 */
export function JoinColumn(
  options: Array<JoinColumnOptions>
): PropertyDecorator;

/**
 * JoinColumn decorator used on one-to-one relations to specify owner side of relationship.
 * It also can be used on both one-to-one and many-to-one relations to specify custom column name
 * or custom referenced column.
 */
export function JoinColumn(
  optionsOrOptionsArray?: JoinColumnOptions | Array<JoinColumnOptions>
): PropertyDecorator {
  return function (object: object, propertyKey: string | symbol) {
    const options = Array.isArray(optionsOrOptionsArray)
      ? optionsOrOptionsArray
      : [optionsOrOptionsArray || {}];
    options.forEach((options) => {
      getMetadataArgsStorage().joinColumns.push({
        target: object.constructor as unknown as TFunction | string,
        propertyName: propertyKey,
        name: options.name,
        referencedColumn: options.referencedColumn,
        foreignKeyConstraintName: options.foreignKeyConstraintName,
      } as unknown as JoinColumnMetadataArgs);
    });
  };
}
