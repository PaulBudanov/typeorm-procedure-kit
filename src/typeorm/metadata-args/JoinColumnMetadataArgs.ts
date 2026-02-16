import type { TFunction } from '../../types/utility.types.js';

/**
 * Arguments for JoinColumnMetadata class.
 */
export interface JoinColumnMetadataArgs {
  /**
   * Class to which this column is applied.
   */
  target: TFunction | string;

  /**
   * Class's property name to which this column is applied.
   */
  propertyName: string;

  /**
   * Name of the column.
   */
  name?: string;

  /**
   * Name of the column in the entity to which this column is referenced.
   * This is column property name, not a column database name.
   */
  referencedColumnName?: string;

  /**
   * Name of the foreign key constraint.
   */
  foreignKeyConstraintName?: string;
}
