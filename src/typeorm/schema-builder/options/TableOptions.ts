import type { TableCheckOptions } from './TableCheckOptions.js';
import type { TableColumnOptions } from './TableColumnOptions.js';
import type { TableExclusionOptions } from './TableExclusionOptions.js';
import type { TableForeignKeyOptions } from './TableForeignKeyOptions.js';
import type { TableIndexOptions } from './TableIndexOptions.js';
import type { TableUniqueOptions } from './TableUniqueOptions.js';

/**
 * Table options.
 */
export interface TableOptions {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Table schema.
   */
  schema?: string;

  /**
   * Table database.
   */
  database?: string;

  /**
   * Table name.
   */
  name: string;

  /**
   * Table columns.
   */
  columns?: Array<TableColumnOptions>;

  /**
   * Table indices.
   */
  indices?: Array<TableIndexOptions>;

  /**
   * Table foreign keys.
   */
  foreignKeys?: Array<TableForeignKeyOptions>;

  /**
   * Table unique constraints.
   */
  uniques?: Array<TableUniqueOptions>;

  /**
   * Table check constraints.
   */
  checks?: Array<TableCheckOptions>;

  /**
   * Table check constraints.
   */
  exclusions?: Array<TableExclusionOptions>;

  /**
   * Indicates if table was just created.
   * This is needed, for example to check if we need to skip primary keys creation
   * for new tables.
   */
  justCreated?: boolean;

  /**
   * Enables Sqlite "WITHOUT ROWID" modifier for the "CREATE TABLE" statement
   */
  withoutRowid?: boolean;

  /**
   * Table engine.
   */
  engine?: string;

  /**
   * Table comment. Not supported by all database types.
   */
  comment?: string;
}
