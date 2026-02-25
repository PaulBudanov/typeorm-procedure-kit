import { merge } from 'lodash-es';

import type { PrimaryColumnOptions } from '../../typeorm/decorator/columns/PrimaryColumn.js';
import { getMetadataArgsStorage } from '../../typeorm/globals.js';
import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @PrimaryColumn decorator with additional options.
 * Allows to register a primary column with options that are not supported by the original @PrimaryColumn decorator.
 * @param {Partial<PrimaryColumnOptions>} overrideSource - Partial PrimaryColumnOptions object to override the existing column options.
 * @returns {PropertyDecorator} - The extended primary column decorator.
 * @example
 * class User {
 *   @PrimaryColumn({ type: 'uuid', default: 'uuid_generate_v4()' })
 *   @ExtendPrimaryColumn({ onUpdate: 'uuid_generate_v4()' })
 *   id: string;
 * }
 */
export function ExtendPrimaryColumn(
  overrideSource: Partial<PrimaryColumnOptions>
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
        `Primary Column "${propertyKey.toString()}" not found. ` +
          'Register column with @PrimaryColumn() decorator first.'
      );
    Object.assign(columnMetadata, {
      options: merge({}, columnMetadata.options, overrideSource),
    });
  };
}
