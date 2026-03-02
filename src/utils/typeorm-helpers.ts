import { cloneDeep, merge } from 'lodash-es';

import type { ColumnMetadataArgs } from '../typeorm/metadata-args/ColumnMetadataArgs.js';
import type { GeneratedMetadataArgs } from '../typeorm/metadata-args/GeneratedMetadataArgs.js';
import type { MetadataArgsStorage } from '../typeorm/metadata-args/MetadataArgsStorage.js';
import type { TableMetadataArgs } from '../typeorm/metadata-args/TableMetadataArgs.js';
import type { UniqueMetadataArgs } from '../typeorm/metadata-args/UniqueMetadataArgs.js';
import type { TFunction } from '../types/utility.types.js';

//TODO: In the future need to be refactored, because deep clone is not a good idea. After start write new ORM should be refactored.
export abstract class TypeOrmHelpers {
  /**
   * Finds a column in a hierarchy of objects.
   * @param columns The columns to search in.
   * @param target The object to start searching from.
   * @param propertyKey The key to search for.
   * @returns An object with the found target and the column if found, otherwise undefined.
   */
  public static findColumnInHierarchy(
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
          Array.isArray(unique.columns) &&
          unique.columns.includes(propertyKey)
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
  public static findEntityMetadata(
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

  public static updateColumnMetadata(
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

  public static updateGenerationMetadata(
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

  public static updateUniqueMetadata(
    storage: MetadataArgsStorage,
    targetRegister: object,
    propertyKey: string,
    isUnique: boolean,
    unique?: UniqueMetadataArgs
  ): void {
    if (isUnique)
      if (!unique)
        storage.uniques.push({
          target: targetRegister as TFunction,
          columns: [propertyKey],
        });
      else {
        const copyUnique = cloneDeep(unique);
        Object.assign(unique, {
          target: targetRegister as TFunction,
          columns: [propertyKey],
        });
        if (
          storage.uniques.findIndex(
            (col) =>
              col.target === copyUnique.target && col.name === copyUnique.name
          ) === -1
        )
          storage.uniques.push(copyUnique);
      }
    else {
      const existingIndex = storage.uniques.findIndex((unique) => {
        return (
          unique.target === targetRegister &&
          Array.isArray(unique.columns) &&
          unique.columns.includes(propertyKey)
        );
      });
      if (existingIndex !== -1) {
        storage.uniques.splice(existingIndex, 1);
      }
    }
    return;
  }
}
