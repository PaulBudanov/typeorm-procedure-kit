import type { TFunction } from '../../types/utility.types.js';

/**
 * Arguments for NamingStrategyMetadata class.
 */
export interface NamingStrategyMetadataArgs {
  /**
   * Class to which this column is applied.
   */
  readonly target: TFunction;

  /**
   * Strategy name.
   */
  readonly name: string;
}
