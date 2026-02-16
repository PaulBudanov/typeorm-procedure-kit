import type { TFunction } from '../../types/utility.types.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { UniqueMetadataArgs } from '../metadata-args/UniqueMetadataArgs.js';
import type { NamingStrategyInterface } from '../naming-strategy/NamingStrategyInterface.js';

import { ColumnMetadata } from './ColumnMetadata.js';
import { EmbeddedMetadata } from './EmbeddedMetadata.js';
import { EntityMetadata } from './EntityMetadata.js';
import type { DeferrableType } from './types/DeferrableType.js';

/**
 * Unique metadata contains all information about table's unique constraints.
 */
export class UniqueMetadata {
  // ---------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata of the class to which this unique constraint is applied.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Embedded metadata if this unique was applied on embedded.
   */
  public embeddedMetadata?: EmbeddedMetadata;

  /**
   * Target class to which metadata is applied.
   */
  public target?: TFunction | string;

  /**
   * Unique columns.
   */
  public columns: Array<ColumnMetadata> = [];

  /**
   * Indicate if unique constraints can be deferred.
   */
  public deferrable?: DeferrableType;

  /**
   * User specified unique constraint name.
   */
  public givenName?: string;

  /**
   * User specified column names.
   */
  public givenColumnNames?:
    | ((object?: unknown) => Array<unknown> | Record<string, number>)
    | Array<string>;

  /**
   * Final unique constraint name.
   * If unique constraint name was given by a user then it stores normalized (by naming strategy) givenName.
   * If unique constraint name was not given then its generated.
   */
  public name!: string;

  /**
   * Map of column names with order set.
   * Used only by MongoDB driver.
   */
  public columnNamesWithOrderingMap: Record<string, number> = {};

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    embeddedMetadata?: EmbeddedMetadata;
    columns?: Array<ColumnMetadata>;
    args?: UniqueMetadataArgs;
  }) {
    this.entityMetadata = options.entityMetadata;
    this.embeddedMetadata = options.embeddedMetadata;
    if (options.columns) this.columns = options.columns;

    if (options.args) {
      this.target = options.args.target;
      this.givenName = options.args.name;
      this.givenColumnNames = options.args.columns;
      this.deferrable = options.args.deferrable;
    }
  }

  // ---------------------------------------------------------------------
  // Public Build Methods
  // ---------------------------------------------------------------------

  /**
   * Builds some depend unique constraint properties.
   * Must be called after all entity metadata's properties map, columns and relations are built.
   */
  public build(namingStrategy: NamingStrategyInterface): this {
    const map: Record<string, number> = {};

    // if columns already an array of string then simply return it
    if (this.givenColumnNames) {
      let columnPropertyPaths: Array<string> = [];
      if (Array.isArray(this.givenColumnNames)) {
        columnPropertyPaths = this.givenColumnNames.map((columnName) => {
          if (this.embeddedMetadata)
            return this.embeddedMetadata.propertyPath + '.' + columnName;

          return columnName.trim();
        });
        columnPropertyPaths.forEach((propertyPath) => (map[propertyPath] = 1));
      } else {
        // if columns is a function that returns array of field names then execute it and get columns names from it
        const columnsFnResult = this.givenColumnNames(
          this.entityMetadata.propertiesMap
        );
        if (Array.isArray(columnsFnResult)) {
          columnPropertyPaths = columnsFnResult.map((i: unknown) => String(i));
          columnPropertyPaths.forEach((name) => (map[name] = 1));
        } else {
          columnPropertyPaths = Object.keys(columnsFnResult).map((i: unknown) =>
            String(i)
          );
          Object.keys(columnsFnResult).forEach(
            (columnName) =>
              (map[columnName] = columnsFnResult[columnName] as number)
          );
        }
      }

      this.columns = columnPropertyPaths
        .map((propertyName) => {
          const columnWithSameName = this.entityMetadata.columns.find(
            (column) => column.propertyPath === propertyName
          );
          if (columnWithSameName) {
            return [columnWithSameName];
          }
          const relationWithSameName = this.entityMetadata.relations.find(
            (relation) =>
              relation.isWithJoinColumn &&
              relation.propertyName === propertyName
          );
          if (relationWithSameName) {
            return relationWithSameName.joinColumns;
          }
          const indexName = this.givenName ? '"' + this.givenName + '" ' : '';
          const entityName = this.entityMetadata.targetName;
          throw new TypeORMError(
            `Unique constraint ${indexName}contains column that is missing in the entity (${entityName}): ` +
              propertyName
          );
        })
        .reduce((a, b) => a.concat(b));
    }

    this.columnNamesWithOrderingMap = Object.keys(map).reduce(
      (updatedMap, key) => {
        const column = this.entityMetadata.columns.find(
          (column) => column.propertyPath === key
        );
        if (column) updatedMap[column.databasePath] = map[key] as number;

        return updatedMap;
      },
      {} as Record<string, number>
    );

    this.name = this.givenName
      ? this.givenName
      : namingStrategy.uniqueConstraintName(
          this.entityMetadata.tableName,
          this.columns.map((column) => column.databaseName)
        );
    return this;
  }
}
