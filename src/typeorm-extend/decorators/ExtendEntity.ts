import { merge } from 'lodash-es';

import type { EntityOptions } from '../../typeorm/decorator/options/EntityOptions.js';
import { getMetadataArgsStorage } from '../../typeorm/globals.js';
import type { TFunction } from '../../types/utility.types.js';
import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @Entity decorator with additional options.
 * Allows to register an entity with options that are not supported by the original @Entity decorator.
 * @param {Partial<EntityOptions>} overrideOptions - Partial EntityOptions object to override the existing entity options.
 * @param {boolean} [isRegisterToParentTarget=false] - Whether to register the entity to the parent target or to the target itself.
 * @returns {ClassDecorator} - The extended entity decorator.
 * @example
 * class User {
 *   @Entity({ type: 'uuid', default: 'uuid_generate_v4()' })
 *   @ExtendEntity({ onUpdate: 'uuid_generate_v4()' })
 *   id: string;
 * }
 */
export function ExtendEntity(
  overrideOptions?: Partial<EntityOptions>,
  isRegisterToParentTarget = false
): ClassDecorator {
  return (target: object): void => {
    const storage = getMetadataArgsStorage();

    const entityMetadata = TypeOrmHelpers.findEntityMetadata(
      storage.tables,
      target as TFunction
    );

    if (!entityMetadata.table || !entityMetadata.foundTarget) {
      throw new ServerError(
        `Entity "${target.toString()}" not registered. Original сlass target name: "${entityMetadata.foundTarget}". ` +
          'Register entity with @Entity() decorator first.'
      );
    }
    const targetRegister = isRegisterToParentTarget
      ? entityMetadata.foundTarget
      : target;
    Object.assign(
      entityMetadata,
      {
        target: targetRegister,
      },
      merge({}, entityMetadata, overrideOptions)
    );
  };
}
