import type { EntityTarget } from '../common/EntityTarget.js';
import type { ForeignKeyOptions } from '../decorator/options/ForeignKeyOptions.js';

export interface EntitySchemaForeignKeyOptions extends ForeignKeyOptions {
  /**
   * Indicates with which entity this relation is made.
   */
  target: EntityTarget<unknown>;

  /**
   * Column names which included by this foreign key.
   */
  columnNames: Array<string>;

  /**
   * Column names which included by this foreign key.
   */
  referencedColumnNames: Array<string>;
}
