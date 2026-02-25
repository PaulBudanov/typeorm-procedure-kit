import type { TFunction } from '../../types/utility.types.js';

/**
 * Arguments for EntitySubscriberMetadata class.
 */
export interface EntitySubscriberMetadataArgs {
  /**
   * Class to which subscriber is applied.
   */
  readonly target: TFunction;
}
