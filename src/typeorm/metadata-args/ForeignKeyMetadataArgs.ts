import type { TFunction } from '../../types/utility.types.js';
import type { DeferrableType } from '../metadata/types/DeferrableType.js';
import type { OnDeleteType } from '../metadata/types/OnDeleteType.js';
import type { OnUpdateType } from '../metadata/types/OnUpdateType.js';
import type { PropertyTypeFactory } from '../metadata/types/PropertyTypeInFunction.js';
import type { RelationTypeInFunction } from '../metadata/types/RelationTypeInFunction.js';

/**
 * Arguments for ForeignKeyMetadata class.
 */
export interface ForeignKeyMetadataArgs {
  /**
   * Class to which foreign key is applied.
   */
  readonly target: TFunction | string;

  /**
   * Class's property name to which this foreign key is applied.
   */
  readonly propertyName?: string;

  /**
   * Type of the relation. This type is in function because of language specifics and problems with recursive
   * referenced classes.
   */
  readonly type: RelationTypeInFunction;

  /**
   * Foreign key constraint name.
   */
  readonly name?: string;

  /**
   * Inverse side of the relation.
   */
  readonly inverseSide?: PropertyTypeFactory<unknown>;

  /**
   * Column names which included by this foreign key.
   */
  readonly columnNames?: Array<string>;

  /**
   * Column names which included by this foreign key.
   */
  readonly referencedColumnNames?: Array<string>;

  /**
   * "ON DELETE" of this foreign key, e.g. what action database should perform when
   * referenced stuff is being deleted.
   */
  readonly onDelete?: OnDeleteType;

  /**
   * "ON UPDATE" of this foreign key, e.g. what action database should perform when
   * referenced stuff is being updated.
   */
  readonly onUpdate?: OnUpdateType;

  /**
   * Set this foreign key constraint as "DEFERRABLE" e.g. check constraints at start
   * or at the end of a transaction
   */
  readonly deferrable?: DeferrableType;
}
