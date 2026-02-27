import type { ColumnMetadataArgs } from '../typeorm/metadata-args/ColumnMetadataArgs.js';
import type { TableMetadataArgs } from '../typeorm/metadata-args/TableMetadataArgs.js';
import type { TFunction } from '../types/utility.types.js';

export abstract class TypeOrmHelpers {
  /**
   * Finds a column in a hierarchy of objects.
   * @param columns The columns to search in.
   * @param target The object to start searching from.
   * @param propertyKey The key to search for.
   * @returns An object with the found target and the column if found, otherwise undefined.
   */
  public static findColumnInHierarchy(
    columns: Array<ColumnMetadataArgs>,
    target: object,
    propertyKey: string | symbol
  ): {
    foundTarget: object | null;
    column: ColumnMetadataArgs | undefined;
  } {
    let currentTarget: object | null = target;
    while (currentTarget && currentTarget !== Object) {
      const foundMetadata = columns.find(
        (col) =>
          col.target === currentTarget && col.propertyName === propertyKey
      );
      if (foundMetadata)
        return { foundTarget: currentTarget, column: foundMetadata };
      currentTarget = Object.getPrototypeOf(currentTarget) as object | null;
    }
    return { foundTarget: currentTarget, column: undefined };
  }

  /**
   * Finds an entity metadata in the given array of tables by traversing the prototype chain of the target.
   * The search is done by checking if the current target is equal to the target of the table metadata.
   * If a match is found, the entity metadata is returned. Otherwise, the prototype chain of the target is traversed until the Function prototype is reached.
   * @param tables - Array of table metadata arguments.
   * @param target - Object to find the entity metadata for.
   * @returns An object containing the found target and the entity metadata for the given target if found, otherwise undefined.
   */
  public static findEntityMetadata<T extends TFunction>(
    tables: Array<TableMetadataArgs>,
    target: T
  ): {
    foundTarget: T | null;
    table: TableMetadataArgs | undefined;
  } {
    let found = tables.find((table) => table.target === target);
    if (found) return { foundTarget: target, table: found };
    let currentTarget: T | null = target;
    while (currentTarget && currentTarget !== Function.prototype) {
      found = tables.find((table) => table.target === currentTarget);

      if (found) return { foundTarget: currentTarget, table: found };
      currentTarget = Object.getPrototypeOf(currentTarget) as T | null;
    }

    return { foundTarget: currentTarget, table: undefined };
  }
}
