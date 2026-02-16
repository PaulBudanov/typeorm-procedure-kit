import type { TFunction } from '../../types/utility.types.js';

/**
 * Arguments for CheckMetadata class.
 */
export interface CheckMetadataArgs {
  /**
   * Class to which index is applied.
   */
  target: TFunction | string;

  /**
   * Check constraint name.
   */
  name?: string;

  /**
   * Check expression.
   */
  expression: string;
}
