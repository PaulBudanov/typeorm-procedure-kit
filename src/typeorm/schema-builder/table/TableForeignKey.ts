import { ForeignKeyMetadata } from '../../metadata/ForeignKeyMetadata.js';
import type { TableForeignKeyOptions } from '../options/TableForeignKeyOptions.js';

/**
 * Foreign key from the database stored in this class.
 */
export class TableForeignKey {
  public readonly '@instanceof' = Symbol.for('TableForeignKey');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Name of the foreign key constraint.
   */
  public name?: string;

  /**
   * Column names which included by this foreign key.
   */
  public columnNames: Array<string> = [];

  /**
   * Database of Table referenced in the foreign key.
   */
  public referencedDatabase?: string;

  /**
   * Database of Table referenced in the foreign key.
   */
  public referencedSchema?: string;

  /**
   * Table referenced in the foreign key.
   */
  public referencedTableName: string;

  /**
   * Column names which included by this foreign key.
   */
  public referencedColumnNames: Array<string> = [];

  /**
   * "ON DELETE" of this foreign key, e.g. what action database should perform when
   * referenced stuff is being deleted.
   */
  public onDelete?: string;

  /**
   * "ON UPDATE" of this foreign key, e.g. what action database should perform when
   * referenced stuff is being updated.
   */
  public onUpdate?: string;

  /**
   * Set this foreign key constraint as "DEFERRABLE" e.g. check constraints at start
   * or at the end of a transaction
   */
  public deferrable?: string;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options: TableForeignKeyOptions) {
    this.name = options.name;
    this.columnNames = options.columnNames;
    this.referencedColumnNames = options.referencedColumnNames;
    this.referencedDatabase = options.referencedDatabase;
    this.referencedSchema = options.referencedSchema;
    this.referencedTableName = options.referencedTableName;
    this.onDelete = options.onDelete;
    this.onUpdate = options.onUpdate;
    this.deferrable = options.deferrable;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new copy of this foreign key with exactly same properties.
   */
  public clone(): TableForeignKey {
    return new TableForeignKey({
      name: this.name,
      columnNames: [...this.columnNames],
      referencedColumnNames: [...this.referencedColumnNames],
      referencedDatabase: this.referencedDatabase,
      referencedSchema: this.referencedSchema,
      referencedTableName: this.referencedTableName,
      onDelete: this.onDelete,
      onUpdate: this.onUpdate,
      deferrable: this.deferrable,
    } as TableForeignKeyOptions);
  }

  // -------------------------------------------------------------------------
  // Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new table foreign key from the given foreign key metadata.
   */
  public static create(metadata: ForeignKeyMetadata): TableForeignKey {
    return new TableForeignKey({
      name: metadata.name,
      columnNames: metadata.columnNames,
      referencedColumnNames: metadata.referencedColumnNames,
      referencedDatabase: metadata.referencedEntityMetadata.database,
      referencedSchema: metadata.referencedEntityMetadata.schema,
      referencedTableName: metadata.referencedTablePath,
      onDelete: metadata.onDelete,
      onUpdate: metadata.onUpdate,
      deferrable: metadata.deferrable,
    } as TableForeignKeyOptions);
  }
}
