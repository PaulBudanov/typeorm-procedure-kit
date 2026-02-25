import type { TFunction } from '../../types/utility.types.js';

/**
 * Arguments for ExclusionMetadata class.
 */
export interface ExclusionMetadataArgs {
  /**
   * Class to which index is applied.
   */
  target: TFunction | string;

  /**
   * Exclusion constraint name.
   */
  name?: string;

  /**
   * Exclusion expression.
   */
  expression: string;
}
