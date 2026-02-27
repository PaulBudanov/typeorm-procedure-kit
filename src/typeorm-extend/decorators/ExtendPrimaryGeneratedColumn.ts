import type { PrimaryGeneratedColumnNumericOptions } from '../../typeorm/decorator/options/PrimaryGeneratedColumnNumericOptions.js';
import { getMetadataArgsStorage } from '../../typeorm/globals.js';
import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @PrimaryGeneratedColumn decorator with additional options.
 * Allows to register a primary generated column with options that are not supported by the original @PrimaryGeneratedColumn decorator.
 * @param {Partial<PrimaryGeneratedColumnNumericOptions>} overrideSource - Partial PrimaryGeneratedColumnNumericOptions object to override the existing column options.
 * @param {boolean} [isRegisterToParentTarget=false] - Whether to register the column to the parent target or to the target itself.
 * @returns {PropertyDecorator} - The extended primary generated column decorator.
 * @example
 * class User {
 *   @PrimaryGeneratedColumn({ type: 'uuid', default: 'uuid_generate_v4()' })
 *   id: string;
 * }
 * class UserOracle extends User {
 *   @ExtendPrimaryGeneratedColumn({ onUpdate: 'uuid_generate_v4()' })
 *   id: string;
 * }
 */
export function ExtendPrimaryGeneratedColumn(
  overrideSource?: Partial<PrimaryGeneratedColumnNumericOptions>,
  isRegisterToParentTarget = false
) {
  return function (target: object, propertyKey: string | symbol): void {
    const storage = getMetadataArgsStorage();
    const targetConstructor = target.constructor;
    const columnMetadata = TypeOrmHelpers.findColumnInHierarchy(
      storage,
      targetConstructor,
      propertyKey.toString()
    );

    if (
      !columnMetadata.foundTarget ||
      !columnMetadata.column ||
      !columnMetadata.generation
    )
      throw new ServerError(
        `Primary Column "${propertyKey.toString()}" not found for entity "${targetConstructor.name}". Original entity name: "${columnMetadata.foundTarget}". ` +
          'Register column with @PrimaryGeneratedColumn() decorator first.'
      );
    const targetRegister = isRegisterToParentTarget
      ? columnMetadata.foundTarget
      : target;
    Object.assign(columnMetadata.generation, {
      target: targetRegister,
    });
    TypeOrmHelpers.updateColumnMetadata(
      storage,
      columnMetadata.column,
      targetRegister,
      overrideSource
    );
    return;
  };
}
