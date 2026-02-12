import { merge } from 'lodash-es';
import { getMetadataArgsStorage, type EntityOptions } from 'typeorm';

import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @Entity decorator with additional options.
 * Allows to register an entity with options that are not supported by the original @Entity decorator.
 * @param {Partial<EntityOptions>} overrideOptions - Partial EntityOptions object to override the existing entity options.
 * @returns {ClassDecorator} - The extended entity decorator.
 * @example
 * class User {
 *   @Entity({ synchronize: false })
 *   @ExtendEntity({ name: 'user' })
 * }
 */
export function ExtendEntity(
  overrideOptions: Partial<EntityOptions>
): ClassDecorator {
  return (target: object): void => {
    const storage = getMetadataArgsStorage();

    const entityMetadata = TypeOrmHelpers.findEntityMetadata(
      storage.tables,
      target as new (...args: Array<unknown>) => unknown
    );

    if (!entityMetadata) {
      throw new ServerError(
        `Entity "${(target as new (...args: Array<unknown>) => unknown).name}" not found. ` +
          'Register entity with @Entity() decorator first.'
      );
    }
    Object.assign(entityMetadata, merge({}, entityMetadata, overrideOptions));
  };
}
