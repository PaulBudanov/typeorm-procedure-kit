import { merge } from 'lodash-es';
import { getMetadataArgsStorage } from 'typeorm';
import type { PrimaryGeneratedColumnNumericOptions } from 'typeorm/decorator/options/PrimaryGeneratedColumnNumericOptions.js';

import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @PrimaryGeneratedColumn decorator with additional options.
 * Allows to register a primary generated column with options that are not supported by the original @PrimaryGeneratedColumn decorator.
 * @param {Partial<PrimaryGeneratedColumnNumericOptions>} overrideSource - Partial PrimaryGeneratedColumnNumericOptions object to override the existing column options.
 * @returns {PropertyDecorator} - The extended primary generated column decorator.
 * @example
 * class User {
 *   @PrimaryGeneratedColumn({ type: 'uuid', default: 'uuid_generate_v4()' })
 *   @ExtendPrimaryGeneratedColumn({ onUpdate: 'uuid_generate_v4()' })
 *   id: string;
 * }
 */
export function ExtendPrimaryGeneratedColumn(
  overrideSource: Partial<PrimaryGeneratedColumnNumericOptions>
) {
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
          'Register column with @PrimaryGeneratedColumn() decorator first.'
      );
    Object.assign(columnMetadata, {
      options: merge({}, columnMetadata.options, overrideSource),
    });
  };
}
