import type { ColumnMetadataArgs } from 'typeorm/metadata-args/ColumnMetadataArgs.js';
import type { TableMetadataArgs } from 'typeorm/metadata-args/TableMetadataArgs.js';

export abstract class TypeOrmHelpers {
  /**
   * Finds a column metadata in the given array of columns by traversing the prototype chain of the target.
   * The search is done by checking if the current target is equal to the target of the column metadata and if the property name matches.
   * If a match is found, the column metadata is returned. Otherwise, the prototype chain of the target is traversed until the Object prototype is reached.
   * @param columns - Array of column metadata arguments.
   * @param target - Object to find the column metadata for.
   * @param propertyKey - String or symbol representing the property name to find the column metadata for.
   * @returns The column metadata for the given target and property key if found, otherwise undefined.
   */
  public static findColumnInHierarchy(
    columns: Array<ColumnMetadataArgs>,
    target: object,
    propertyKey: string | symbol
  ): ColumnMetadataArgs | undefined {
    let currentTarget: object | null = target;
    while (currentTarget && currentTarget !== Object) {
      const foundMetadata = columns.find(
        (col) =>
          col.target === currentTarget && col.propertyName === propertyKey
      );
      if (foundMetadata) return foundMetadata;
      currentTarget = Object.getPrototypeOf(currentTarget) as object | null;
    }
    return undefined;
  }

  /**
   * Finds the entity metadata for a given target in the given array of tables.
   * The search is done by traversing the prototype chain of the target.
   * @param tables - Array of table metadata arguments.
   * @param target - Object to find the entity metadata for.
   * @returns The entity metadata for the given target if found, otherwise undefined.
   */
  public static findEntityMetadata<
    T extends new (...args: Array<unknown>) => unknown,
  >(
    tables: Array<TableMetadataArgs>,
    target: T
  ): TableMetadataArgs | undefined {
    let found = tables.find((table) => table.target === target);
    if (found) return found;
    let currentTarget: T | null = target;
    while (currentTarget && currentTarget !== Function.prototype) {
      found = tables.find((table) => table.target === currentTarget);

      if (found) return found;
      currentTarget = Object.getPrototypeOf(currentTarget) as T | null;
    }

    return undefined;
  }
}
