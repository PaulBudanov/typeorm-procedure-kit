import type { TFunction } from '../../types/utility.types.js';
import type { DeferrableType } from '../metadata/types/DeferrableType.js';
import type { EntityPropertiesMap } from '../metadata/types/EntityPropertiesMap.js';

export type UniqueColumnsResolver = (
  object: EntityPropertiesMap
) => Array<unknown> | Record<string, number>;

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
  columns?: UniqueColumnsResolver | Array<string>;

  /**
   * Indicate if unique constraints can be deferred.
   */
  deferrable?: DeferrableType;
}
