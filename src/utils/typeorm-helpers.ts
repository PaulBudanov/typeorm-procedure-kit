import cloneDeep from 'lodash/cloneDeep.js';
import merge from 'lodash/merge.js';

import { ServerError } from './server-error.js';

import type { ColumnMetadataArgs } from '../typeorm/metadata-args/ColumnMetadataArgs.js';
import type { GeneratedMetadataArgs } from '../typeorm/metadata-args/GeneratedMetadataArgs.js';
import type { MetadataArgsStorage } from '../typeorm/metadata-args/MetadataArgsStorage.js';
import type { TableMetadataArgs } from '../typeorm/metadata-args/TableMetadataArgs.js';
import type { UniqueMetadataArgs } from '../typeorm/metadata-args/UniqueMetadataArgs.js';
import type { TFunction } from '../types/utility.types.js';

//TODO: In the future need to be refactored, because deep clone is not a good idea. After start write new ORM should be refactored.
class TypeOrmHelpersApi {
  /**
   * Finds a column in a hierarchy of objects.
   * @param metadataArgs Metadata storage containing TypeORM column, generation, and unique metadata.
   * @param target The object to start searching from.
   * @param propertyKey The key to search for.
   * @returns An object with the found target and the column if found, otherwise undefined.
   */
  public findColumnInHierarchy(
    metadataArgs: MetadataArgsStorage,
    target: object,
    propertyKey: string
  ): {
    foundTarget: object | null;
    column: ColumnMetadataArgs | undefined;
    generation: GeneratedMetadataArgs | undefined;
    unique: UniqueMetadataArgs | undefined;
  } {
    let currentTarget: object | null = target;
    while (currentTarget && currentTarget !== Object) {
      const foundMetadata = metadataArgs.columns.find(
        (col) =>
          col.target === currentTarget && col.propertyName === propertyKey
      );
      const foundGeneration = metadataArgs.generations.find(
        (generation) =>
          generation.target === currentTarget &&
          generation.propertyName === propertyKey
      );
      const foundUnique = metadataArgs.uniques.find(
        (unique) =>
          unique.target === currentTarget &&
          this.isSingleColumnUnique(unique, propertyKey)
      );
      if (foundMetadata)
        return {
          foundTarget: currentTarget,
          column: foundMetadata,
          generation: foundGeneration,
          unique: foundUnique,
        };
      currentTarget = Object.getPrototypeOf(currentTarget) as object | null;
    }
    return {
      foundTarget: currentTarget,
      column: undefined,
      generation: undefined,
      unique: undefined,
    };
  }

  /**
   * Finds an entity metadata in the given array of tables by traversing the prototype chain of the target.
   * The search is done by checking if the current target is equal to the target of the table metadata.
   * If a match is found, the entity metadata is returned. Otherwise, the prototype chain of the target is traversed until the Function prototype is reached.
   * @param tables - Array of table metadata arguments.
   * @param target - Object to find the entity metadata for.
   * @returns An object containing the found target and the entity metadata for the given target if found, otherwise undefined.
   */
  public findEntityMetadata(
    tables: Array<TableMetadataArgs>,
    target: TFunction
  ): {
    foundTarget: TFunction | null;
    table: TableMetadataArgs | undefined;
  } {
    let found = tables.find((table) => table.target === target);
    if (found) return { foundTarget: target, table: found };
    let currentTarget: TFunction | null = target;
    while (currentTarget && currentTarget !== Function.prototype) {
      found = tables.find((table) => table.target === currentTarget);

      if (found) return { foundTarget: currentTarget, table: found };
      currentTarget = Object.getPrototypeOf(currentTarget) as TFunction | null;
    }

    return { foundTarget: currentTarget, table: undefined };
  }

  /**
   * Re-registers column metadata on a target and preserves the original metadata copy.
   *
   * Extend decorators use this to derive database-specific entity variants
   * without losing metadata from the base class.
   *
   * @param storage - TypeORM metadata storage to update.
   * @param column - Existing column metadata found in the inheritance chain.
   * @param targetRegister - Target class where the updated metadata should be registered.
   * @param overrideSource - Column options merged over the existing options.
   */
  public updateColumnMetadata(
    storage: MetadataArgsStorage,
    column: ColumnMetadataArgs,
    targetRegister: object,
    overrideSource?: ColumnMetadataArgs['options']
  ): void {
    const copyColumn = cloneDeep(column);
    Object.assign(column, {
      target: targetRegister,
      options: merge({}, column.options, overrideSource),
    });
    if (
      storage.columns.findIndex(
        (col) =>
          col.target === copyColumn.target &&
          col.propertyName === copyColumn.propertyName
      ) === -1
    )
      storage.columns.push(copyColumn);
  }

  /**
   * Updates generated-column metadata for an extended primary column.
   *
   * Passing `false` or `undefined` removes generated metadata from the target;
   * passing `true` uses the `increment` strategy, and passing a string uses it
   * as the generation strategy.
   *
   * @param storage - TypeORM metadata storage to update.
   * @param targetRegister - Target class where generation metadata should be registered.
   * @param propertyKey - Column property name.
   * @param existingGeneration - Generation metadata inherited from the source column.
   * @param generated - Override generation setting.
   */
  public updateGenerationMetadata(
    storage: MetadataArgsStorage,
    targetRegister: object,
    propertyKey: string,
    existingGeneration?: GeneratedMetadataArgs,
    generated?: string | boolean
  ): void {
    const hasGeneratedOption = generated !== undefined && generated !== false;
    if (hasGeneratedOption) {
      const strategy = typeof generated === 'string' ? generated : 'increment';
      if (existingGeneration) {
        const copyGeneration = cloneDeep(existingGeneration);
        Object.assign(existingGeneration, {
          target: targetRegister,
          propertyName: propertyKey,
          strategy,
        });
        if (
          storage.generations.findIndex(
            (col) =>
              col.target === copyGeneration.target &&
              col.propertyName === copyGeneration.propertyName
          ) === -1
        )
          storage.generations.push(copyGeneration);
      } else
        storage.generations.push({
          target: targetRegister,
          propertyName: propertyKey,
          strategy,
        } as GeneratedMetadataArgs);
    } else {
      const existingIndex = storage.generations.findIndex(
        (generaion) =>
          generaion.target === targetRegister &&
          generaion.propertyName === propertyKey
      );
      if (existingIndex !== -1) {
        storage.generations.splice(existingIndex, 1);
      }
    }
  }

  /**
   * Adds or removes single-column unique metadata for an extended column.
   * Inherited uniqueness cannot be disabled without changing the ancestor.
   * @param storage - TypeORM metadata storage to update.
   * @param targetRegister - Target class where unique metadata should be registered.
   * @param propertyKey - Column property name.
   * @param isUnique - Whether the column should be unique.
   * @param _unique - Retained for compatibility; metadata is resolved from the full target hierarchy.
   */
  public updateUniqueMetadata(
    storage: MetadataArgsStorage,
    targetRegister: object,
    propertyKey: string,
    isUnique: boolean,
    _unique?: UniqueMetadataArgs
  ): void {
    let currentTarget: object | null = targetRegister;
    while (currentTarget && currentTarget !== Function.prototype) {
      const hasUnique = storage.uniques.some(
        (unique) =>
          unique.target === currentTarget &&
          this.isSingleColumnUnique(unique, propertyKey)
      );
      if (hasUnique) {
        if (isUnique) return;
        if (currentTarget !== targetRegister)
          throw new ServerError(
            `Cannot disable inherited unique constraint for column "${propertyKey}". Register uniqueness on concrete entities instead.`
          );
      }
      currentTarget = Object.getPrototypeOf(currentTarget) as object | null;
    }

    if (isUnique) {
      storage.uniques.push({
        target: targetRegister as TFunction,
        columns: [propertyKey],
      });
      return;
    }

    for (let index = storage.uniques.length - 1; index >= 0; index--) {
      const unique = storage.uniques[index];
      if (
        unique?.target === targetRegister &&
        this.isSingleColumnUnique(unique, propertyKey)
      )
        storage.uniques.splice(index, 1);
    }
  }

  private isSingleColumnUnique(
    unique: UniqueMetadataArgs,
    propertyKey: string
  ): boolean {
    return (
      Array.isArray(unique.columns) &&
      unique.columns.length === 1 &&
      unique.columns[0] === propertyKey
    );
  }
}

const typeOrmHelpers = new TypeOrmHelpersApi();

export { typeOrmHelpers as TypeOrmHelpers };
