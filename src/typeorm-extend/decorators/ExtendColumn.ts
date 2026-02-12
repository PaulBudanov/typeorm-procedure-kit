import { merge } from 'lodash-es';
import { getMetadataArgsStorage, type ColumnOptions } from 'typeorm';

import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @Column decorator with additional options.
 * Allows to register a column with options that are not supported by the original @Column decorator.
 * @param {Partial<ColumnOptions>} overrideSource - Partial ColumnOptions object to override the existing column options.
 * @returns {PropertyDecorator} - The extended column decorator.
 * @example
 * class User {
 *   @Column({ length: 255 })
 *   @ExtendColumn({ nullable: true })
 *   name: string;
 * }
 */
export function ExtendColumn(
  overrideSource: Partial<ColumnOptions>
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    const storage = getMetadataArgsStorage();
    const targetConstructor = target.constructor;
    const columnMetadata = TypeOrmHelpers.findColumnInHierarchy(
      storage.columns,
      targetConstructor,
      propertyKey
    );

    if (!columnMetadata)
      throw new ServerError(
        `Column "${propertyKey.toString()}" not found. ` +
          'Register column with @Column() decorator first.'
      );
    Object.assign(columnMetadata, {
      options: merge({}, columnMetadata.options, overrideSource),
    });
  };
}
