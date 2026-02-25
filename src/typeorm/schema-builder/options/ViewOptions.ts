import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import type { DataSource } from '../../data-source/DataSource.js';
import type { SelectQueryBuilder } from '../../query-builder/SelectQueryBuilder.js';

/**
 * View options.
 */
export interface ViewOptions {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Database name that this table resides in if it applies.
   */
  database?: string;

  /**
   * Schema name that this table resides in if it applies.
   */
  schema?: string;

  /**
   * View name.
   */
  name: string;

  /**
   * View expression.
   */
  expression:
    | string
    | ((connection: DataSource) => SelectQueryBuilder<ObjectLiteral>);

  /**
   * Indicates if view is materialized
   */

  materialized?: boolean;
}
