import type { DeferrableType } from '../metadata/types/DeferrableType.js';

export interface EntitySchemaUniqueOptions {
  /**
   * Unique constraint name.
   */
  name?: string;

  /**
   * Unique column names.
   */
  columns?:
    | ((object?: unknown) => Array<unknown> | Record<string, number>)
    | Array<string>;

  /**
   * Indicate if unique constraints can be deferred.
   */
  deferrable?: DeferrableType;
}
