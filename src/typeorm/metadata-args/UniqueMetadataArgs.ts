import type { TFunction } from '../../types/utility.types.js';
import type { DeferrableType } from '../metadata/types/DeferrableType.js';

/**
 * Arguments for UniqueMetadata class.
 */
export interface UniqueMetadataArgs {
  /**
   * Class to which index is applied.
   */
  target: TFunction | string;

  /**
   * Unique constraint name.
   */
  name?: string;

  /**
   * Columns combination to be unique.
   */
  columns?:
    | ((object?: unknown) => Array<unknown> | Record<string, number>)
    | Array<string>;

  /**
   * Indicate if unique constraints can be deferred.
   */
  deferrable?: DeferrableType;
}
