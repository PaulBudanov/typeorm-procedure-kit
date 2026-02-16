import type { EntityTarget } from '../common/EntityTarget.js';
import type { ForeignKeyOptions } from '../decorator/options/ForeignKeyOptions.js';

export interface EntitySchemaColumnForeignKeyOptions extends ForeignKeyOptions {
  /**
   * Indicates with which entity this relation is made.
   */
  target: EntityTarget<unknown>;

  /**
   * Inverse side of the relation.
   */
  inverseSide?: string;
}
