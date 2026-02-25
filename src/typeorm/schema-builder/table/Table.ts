import type { Driver } from '../../driver/Driver.js';
import type { EntityMetadata } from '../../metadata/EntityMetadata.js';
import type { TableOptions } from '../options/TableOptions.js';
import { TableUtils } from '../util/TableUtils.js';

import { TableCheck } from './TableCheck.js';
import { TableColumn } from './TableColumn.js';
import { TableExclusion } from './TableExclusion.js';
import { TableForeignKey } from './TableForeignKey.js';
import { TableIndex } from './TableIndex.js';
import { TableUnique } from './TableUnique.js';

/**
 * Table in the database represented in this class.
 */
export class Table {
  public readonly '@instanceof' = Symbol.for('Table');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Database name that this table resides in if it applies.
   */
  public database?: string;

  /**
   * Schema name that this table resides in if it applies.
   */
  public schema?: string;

  /**
   * May contain database name, schema name and table name, unless they're the current database.
   *
   * E.g. myDB.mySchema.myTable
   */
  public name!: string;

  /**
   * Table columns.
   */
  public columns: Array<TableColumn> = [];

  /**
   * Table indices.
   */
  public indices: Array<TableIndex> = [];

  /**
   * Table foreign keys.
   */
  public foreignKeys: Array<TableForeignKey> = [];

  /**
   * Table unique constraints.
   */
  public uniques: Array<TableUnique> = [];

  /**
   * Table check constraints.
   */
  public checks: Array<TableCheck> = [];

  /**
   * Table exclusion constraints.
   */
  public exclusions: Array<TableExclusion> = [];

  /**
   * Indicates if table was just created.
   * This is needed, for example to check if we need to skip primary keys creation
   * for new tables.
   */
  public justCreated = false;

  /**
   * Enables Sqlite "WITHOUT ROWID" modifier for the "CREATE TABLE" statement
   */
  public withoutRowid?: boolean = false;

  /**
   * Table engine.
   */
  public engine?: string;

  /**
   * Table comment. Not supported by all database types.
   */
  public comment?: string;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options?: TableOptions) {
    if (options) {
      this.database = options.database;
      this.schema = options.schema;
      this.name = options.name;

      if (options.columns)
        this.columns = options.columns.map((column) => new TableColumn(column));

      if (options.indices)
        this.indices = options.indices.map((index) => new TableIndex(index));

      if (options.foreignKeys)
        this.foreignKeys = options.foreignKeys.map(
          (foreignKey) =>
            new TableForeignKey({
              ...foreignKey,
              referencedDatabase:
                foreignKey?.referencedDatabase || options.database,
              referencedSchema: foreignKey?.referencedSchema || options.schema,
            })
        );

      if (options.uniques)
        this.uniques = options.uniques.map((unique) => new TableUnique(unique));

      if (options.checks)
        this.checks = options.checks.map((check) => new TableCheck(check));

      if (options.exclusions)
        this.exclusions = options.exclusions.map(
          (exclusion) => new TableExclusion(exclusion)
        );

      if (options.justCreated !== undefined)
        this.justCreated = options.justCreated;

      if (options.withoutRowid) this.withoutRowid = options.withoutRowid;

      this.engine = options.engine;

      this.comment = options.comment;
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  public get primaryColumns(): Array<TableColumn> {
    return this.columns.filter((column) => column.isPrimary);
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Clones this table to a new table with all properties cloned.
   */
  public clone(): Table {
    return new Table({
      schema: this.schema,
      database: this.database,
      name: this.name,
      columns: this.columns.map((column) => column.clone()),
      indices: this.indices.map((constraint) => constraint.clone()),
      foreignKeys: this.foreignKeys.map((constraint) => constraint.clone()),
      uniques: this.uniques.map((constraint) => constraint.clone()),
      checks: this.checks.map((constraint) => constraint.clone()),
      exclusions: this.exclusions.map((constraint) => constraint.clone()),
      justCreated: this.justCreated,
      withoutRowid: this.withoutRowid,
      engine: this.engine,
      comment: this.comment,
    });
  }

  /**
   * Add column and creates its constraints.
   */
  public addColumn(column: TableColumn): void {
    this.columns.push(column);
  }

  /**
   * Remove column and its constraints.
   */
  public removeColumn(column: TableColumn): void {
    const foundColumn = this.columns.find((c) => c.name === column.name);
    if (foundColumn) this.columns.splice(this.columns.indexOf(foundColumn), 1);
  }

  /**
   * Adds unique constraint.
   */
  public addUniqueConstraint(uniqueConstraint: TableUnique): void {
    this.uniques.push(uniqueConstraint);
    if (uniqueConstraint.columnNames.length === 1) {
      const uniqueColumn = this.columns.find(
        (column) => column.name === uniqueConstraint.columnNames[0]
      );
      if (uniqueColumn) uniqueColumn.isUnique = true;
    }
  }

  /**
   * Removes unique constraint.
   */
  public removeUniqueConstraint(removedUnique: TableUnique): void {
    const foundUnique = this.uniques.find(
      (unique) => unique.name === removedUnique.name
    );
    if (foundUnique) {
      this.uniques.splice(this.uniques.indexOf(foundUnique), 1);
      if (foundUnique.columnNames.length === 1) {
        const uniqueColumn = this.columns.find(
          (column) => column.name === foundUnique.columnNames[0]
        );
        if (uniqueColumn) uniqueColumn.isUnique = false;
      }
    }
  }

  /**
   * Adds check constraint.
   */
  public addCheckConstraint(checkConstraint: TableCheck): void {
    this.checks.push(checkConstraint);
  }

  /**
   * Removes check constraint.
   */
  public removeCheckConstraint(removedCheck: TableCheck): void {
    const foundCheck = this.checks.find(
      (check) => check.name === removedCheck.name
    );
    if (foundCheck) {
      this.checks.splice(this.checks.indexOf(foundCheck), 1);
    }
  }

  /**
   * Adds exclusion constraint.
   */
  public addExclusionConstraint(exclusionConstraint: TableExclusion): void {
    this.exclusions.push(exclusionConstraint);
  }

  /**
   * Removes exclusion constraint.
   */
  public removeExclusionConstraint(removedExclusion: TableExclusion): void {
    const foundExclusion = this.exclusions.find(
      (exclusion) => exclusion.name === removedExclusion.name
    );
    if (foundExclusion) {
      this.exclusions.splice(this.exclusions.indexOf(foundExclusion), 1);
    }
  }

  /**
   * Adds foreign keys.
   */
  public addForeignKey(foreignKey: TableForeignKey): void {
    this.foreignKeys.push(foreignKey);
  }

  /**
   * Removes foreign key.
   */
  public removeForeignKey(removedForeignKey: TableForeignKey): void {
    const fk = this.foreignKeys.find(
      (foreignKey) => foreignKey.name === removedForeignKey.name
    );
    if (fk) this.foreignKeys.splice(this.foreignKeys.indexOf(fk), 1);
  }

  /**
   * Adds index.
   */
  public addIndex(index: TableIndex, isMysql = false): void {
    this.indices.push(index);

    // in Mysql unique indices and unique constraints are the same thing
    // if index is unique and have only one column, we mark this column as unique
    if (index.columnNames.length === 1 && index.isUnique && isMysql) {
      const column = this.columns.find((c) => c.name === index.columnNames[0]);
      if (column) column.isUnique = true;
    }
  }

  /**
   * Removes index.
   */
  public removeIndex(tableIndex: TableIndex, isMysql = false): void {
    const index = this.indices.find((index) => index.name === tableIndex.name);
    if (index) {
      this.indices.splice(this.indices.indexOf(index), 1);

      // in Mysql unique indices and unique constraints are the same thing
      // if index is unique and have only one column, we move `unique` attribute from its column
      if (index.columnNames.length === 1 && index.isUnique && isMysql) {
        const column = this.columns.find(
          (c) => c.name === index.columnNames[0]
        );
        if (column)
          column.isUnique = this.indices.some(
            (ind) =>
              ind.columnNames.length === 1 &&
              ind.columnNames[0] === column.name &&
              !!index.isUnique
          );
      }
    }
  }

  public findColumnByName(name: string): TableColumn | undefined {
    return this.columns.find((column) => column.name === name);
  }

  /**
   * Returns all column indices.
   */
  public findColumnIndices(column: TableColumn): Array<TableIndex> {
    return this.indices.filter((index) => {
      return !!index.columnNames.find(
        (columnName) => columnName === column.name
      );
    });
  }

  /**
   * Returns all column foreign keys.
   */
  public findColumnForeignKeys(column: TableColumn): Array<TableForeignKey> {
    return this.foreignKeys.filter((foreignKey) => {
      return !!foreignKey.columnNames.find(
        (columnName) => columnName === column.name
      );
    });
  }

  /**
   * Returns all column uniques.
   */
  public findColumnUniques(column: TableColumn): Array<TableUnique> {
    return this.uniques.filter((unique) => {
      return !!unique.columnNames.find(
        (columnName) => columnName === column.name
      );
    });
  }

  /**
   * Returns all column checks.
   */
  public findColumnChecks(column: TableColumn): Array<TableCheck> {
    return this.checks.filter((check) => {
      return !!check.columnNames!.find(
        (columnName) => columnName === column.name
      );
    });
  }

  // -------------------------------------------------------------------------
  // Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates table from a given entity metadata.
   */
  public static create(entityMetadata: EntityMetadata, driver: Driver): Table {
    const database =
      entityMetadata.database === driver.database
        ? undefined
        : entityMetadata.database;
    const schema =
      entityMetadata.schema ===
      (driver.options as unknown as Record<string, unknown>)?.schema
        ? undefined
        : entityMetadata.schema;

    const options: TableOptions = {
      database: entityMetadata.database,
      schema: entityMetadata.schema,
      name: driver.buildTableName(entityMetadata.tableName, schema, database),
      withoutRowid: entityMetadata.withoutRowid,
      engine: entityMetadata.engine,
      columns: entityMetadata.columns
        .filter((column) => column && !column.isVirtualProperty)
        .map((column) => TableUtils.createTableColumnOptions(column, driver)),
      indices: entityMetadata.indices
        .filter((index) => index.synchronize === true)
        .map((index) => TableIndex.create(index)),
      uniques: entityMetadata.uniques.map((unique) =>
        TableUnique.create(unique)
      ),
      checks: entityMetadata.checks.map((check) => TableCheck.create(check)),
      exclusions: entityMetadata.exclusions.map((exclusion) =>
        TableExclusion.create(exclusion)
      ),
      comment: entityMetadata.comment,
    };

    return new Table(options);
  }
}
