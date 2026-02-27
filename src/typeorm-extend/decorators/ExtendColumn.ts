import { merge } from 'lodash-es';

import type { ColumnOptions } from '../../typeorm/decorator/options/ColumnOptions.js';
import { getMetadataArgsStorage } from '../../typeorm/globals.js';
import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @Column decorator with additional options.
 * Allows to register a column with options that are not supported by the original @Column decorator.
 * @param {Partial<ColumnOptions>} overrideSource - Partial ColumnOptions object to override the existing column options.
 * @param {boolean} [isRegisterToParentTarget=false] - Whether to register the column to the parent target or to the target itself.
 * @returns {PropertyDecorator} - The extended column decorator.
 * @example
 * class User {
 *   @Column({ type: 'uuid', default: 'uuid_generate_v4()' })
 *   id: string;
 * }
 * class UserOracle extends User {
 *   @ExtendColumn({ onUpdate: 'uuid_generate_v4()' })
 *   id: string;
 * }
 }
 */
export function ExtendColumn(
  overrideSource?: Partial<ColumnOptions>,
  isRegisterToParentTarget = false
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    const storage = getMetadataArgsStorage();
    const targetConstructor = target.constructor;
    const columnMetadata = TypeOrmHelpers.findColumnInHierarchy(
      storage.columns,
      targetConstructor,
      propertyKey
    );

    if (!columnMetadata.column || !columnMetadata.foundTarget)
      throw new ServerError(
        `Column "${propertyKey.toString()}" not found for entity "${targetConstructor.name}". Original entity name: "${columnMetadata.foundTarget}". ` +
          'Register column with @Column() decorator first.'
      );
    const targetRegister = isRegisterToParentTarget
      ? columnMetadata.foundTarget
      : target;
    Object.assign(columnMetadata, {
      target: targetRegister,
      options: merge({}, columnMetadata.column.options, overrideSource),
    });
    return;
  };
}
