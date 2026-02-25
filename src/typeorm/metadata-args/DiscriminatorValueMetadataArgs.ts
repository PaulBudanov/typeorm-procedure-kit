import type { TFunction } from '../../types/utility.types.js';

/**
 * DiscriminatorValue properties.
 */
export interface DiscriminatorValueMetadataArgs {
  /**
   * Class to which discriminator name is applied.
   */
  readonly target: TFunction | string;

  /**
   * Discriminator value.
   */
  readonly value: unknown;
}
