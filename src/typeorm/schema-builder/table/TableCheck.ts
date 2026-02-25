import type { CheckMetadata } from '../../metadata/CheckMetadata.js';
import type { TableCheckOptions } from '../options/TableCheckOptions.js';

/**
 * Database's table check constraint stored in this class.
 */
export class TableCheck {
  public readonly '@instanceof' = Symbol.for('TableCheck');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Constraint name.
   */
  public name?: string;

  /**
   * Column that contains this constraint.
   */
  public columnNames?: Array<string> = [];

  /**
   * Check expression.
   */
  public expression?: string;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options: TableCheckOptions) {
    this.name = options.name;
    this.columnNames = options.columnNames;
    this.expression = options.expression;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new copy of this constraint with exactly same properties.
   */
  public clone(): TableCheck {
    return new TableCheck({
      name: this.name,
      columnNames: this.columnNames ? [...this.columnNames] : [],
      expression: this.expression,
    } as TableCheckOptions);
  }

  // -------------------------------------------------------------------------
  // Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates checks from the check metadata object.
   */
  public static create(checkMetadata: CheckMetadata): TableCheck {
    return new TableCheck({
      name: checkMetadata.name,
      expression: checkMetadata.expression,
    } as TableCheckOptions);
  }
}
