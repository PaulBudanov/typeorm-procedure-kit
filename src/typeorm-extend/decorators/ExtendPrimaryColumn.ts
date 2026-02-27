import type { PrimaryColumnOptions } from '../../typeorm/decorator/columns/PrimaryColumn.js';
import { getMetadataArgsStorage } from '../../typeorm/globals.js';
import { ServerError } from '../../utils/server-error.js';
import { TypeOrmHelpers } from '../../utils/typeorm-helpers.js';

/**
 * Extends the @PrimaryColumn decorator with additional options.
 * Allows to register a primary column with options that are not supported by the original @PrimaryColumn decorator.
 * @param {Partial<PrimaryColumnOptions>} [overrideSource] - Partial PrimaryColumnOptions object to override the existing column options.
 * @param {boolean} [isRegisterToParentTarget=false] - Whether to register the column to the parent target or to the target itself.
 * @returns {PropertyDecorator} - The extended primary column decorator.
 * @example
 * class User {
 *   @PrimaryColumn({ type: 'uuid', default: 'uuid_generate_v4()' })
 *   id: string;
 * }
 * class UserOracle extends User {
 *   @ExtendPrimaryColumn({ onUpdate: 'uuid_generate_v4()' })
 *   id: string;
 * }
 */
export function ExtendPrimaryColumn(
  overrideSource?: Partial<PrimaryColumnOptions>,
  isRegisterToParentTarget = false
): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    const storage = getMetadataArgsStorage();
    const targetConstructor = target.constructor;
    const columnMetadata = TypeOrmHelpers.findColumnInHierarchy(
      storage,
      targetConstructor,
      propertyKey.toString()
    );

    if (!columnMetadata.foundTarget || !columnMetadata.column)
      throw new ServerError(
        `Primary Column "${propertyKey.toString()}" not found for entity "${targetConstructor.name}". Original entity name: "${columnMetadata.foundTarget}". ` +
          'Register column with @PrimaryColumn() decorator first.'
      );
    const targetRegister = isRegisterToParentTarget
      ? columnMetadata.foundTarget
      : target;
    TypeOrmHelpers.updateColumnMetadata(
      storage,
      columnMetadata.column,
      targetRegister,
      overrideSource
    );
    TypeOrmHelpers.updateGenerationMetadata(
      storage,
      targetRegister,
      propertyKey.toString(),
      columnMetadata.generation,
      !overrideSource?.generated && overrideSource?.generated !== false
        ? (columnMetadata.column.options.generated ?? undefined)
        : overrideSource?.generated
    );
  };
}
