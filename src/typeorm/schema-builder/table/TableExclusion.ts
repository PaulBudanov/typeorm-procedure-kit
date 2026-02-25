import type { ExclusionMetadata } from '../../metadata/ExclusionMetadata.js';
import type { TableExclusionOptions } from '../options/TableExclusionOptions.js';

/**
 * Database's table exclusion constraint stored in this class.
 */
export class TableExclusion {
  public readonly '@instanceof' = Symbol.for('TableExclusion');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Constraint name.
   */
  public name?: string;

  /**
   * Exclusion expression.
   */
  public expression?: string;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options: TableExclusionOptions) {
    this.name = options.name;
    this.expression = options.expression;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new copy of this constraint with exactly same properties.
   */
  public clone(): TableExclusion {
    return new TableExclusion({
      name: this.name,
      expression: this.expression,
    } as TableExclusionOptions);
  }

  // -------------------------------------------------------------------------
  // Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates exclusions from the exclusion metadata object.
   */
  public static create(exclusionMetadata: ExclusionMetadata): TableExclusion {
    return new TableExclusion({
      name: exclusionMetadata.name,
      expression: exclusionMetadata.expression,
    } as TableExclusionOptions);
  }
}
