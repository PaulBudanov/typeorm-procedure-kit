import { getMetadataArgsStorage } from '../../typeorm/globals.js';
import type {
  TExtendPrimaryGeneratedColumnOptions,
  TPrimaryGeneratedColumnOverrideDescriptor,
} from '../../types/extend-decorator.types.js';
import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

function isPrimaryGeneratedColumnOverrideDescriptor(
  overrideSource?: TExtendPrimaryGeneratedColumnOptions
): overrideSource is TPrimaryGeneratedColumnOverrideDescriptor {
  return (
    overrideSource !== undefined &&
    ('strategy' in overrideSource || 'options' in overrideSource)
  );
}

/**
 * Extends the @PrimaryGeneratedColumn decorator with additional options.
 * Allows to register a primary generated column with options that are not supported by the original @PrimaryGeneratedColumn decorator.
 * @param {TExtendPrimaryGeneratedColumnOptions} overrideSource - Partial PrimaryGeneratedColumnNumericOptions object to override the existing column options.
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
  overrideSource?: TExtendPrimaryGeneratedColumnOptions,
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
      typeof columnMetadata.foundTarget !== 'function' ||
      !columnMetadata.column ||
      !columnMetadata.generation
    )
      throw new ServerError(
        `Primary Column "${propertyKey.toString()}" not found for entity "${targetConstructor.name}". Original entity name: "${columnMetadata.foundTarget}". ` +
          'Register column with @PrimaryGeneratedColumn() decorator first.'
      );
    const targetRegister = isRegisterToParentTarget
      ? columnMetadata.foundTarget
      : targetConstructor;
    const typedOverrideSource = isPrimaryGeneratedColumnOverrideDescriptor(
      overrideSource
    )
      ? overrideSource.options
      : overrideSource;
    const overrideStrategy = isPrimaryGeneratedColumnOverrideDescriptor(
      overrideSource
    )
      ? overrideSource.strategy
      : undefined;
    TypeOrmHelpers.updateColumnMetadata(
      storage,
      columnMetadata.column,
      targetRegister,
      typedOverrideSource
    );
    TypeOrmHelpers.updateGenerationMetadata(
      storage,
      targetRegister,
      propertyKey.toString(),
      columnMetadata.generation,
      overrideStrategy ?? columnMetadata.generation.strategy ?? undefined
    );
    return;
  };
}
