import type { UniqueMetadata } from '../../metadata/UniqueMetadata.js';
import type { TableUniqueOptions } from '../options/TableUniqueOptions.js';

/**
 * Database's table unique constraint stored in this class.
 */
export class TableUnique {
  public readonly '@instanceof' = Symbol.for('TableUnique');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Constraint name.
   */
  public name?: string;

  /**
   * Columns that contains this constraint.
   */
  public columnNames: Array<string> = [];

  /**
   * Set this foreign key constraint as "DEFERRABLE" e.g. check constraints at start
   * or at the end of a transaction
   */
  public deferrable?: string;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options: TableUniqueOptions) {
    this.name = options.name;
    this.columnNames = options.columnNames;
    this.deferrable = options.deferrable;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new copy of this constraint with exactly same properties.
   */
  public clone(): TableUnique {
    return new TableUnique({
      name: this.name,
      columnNames: [...this.columnNames],
      deferrable: this.deferrable,
    } as TableUniqueOptions);
  }

  // -------------------------------------------------------------------------
  // Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates unique from the unique metadata object.
   */
  public static create(uniqueMetadata: UniqueMetadata): TableUnique {
    return new TableUnique({
      name: uniqueMetadata.name,
      columnNames: uniqueMetadata.columns.map((column) => column.databaseName),
      deferrable: uniqueMetadata.deferrable,
    } as TableUniqueOptions);
  }
}
