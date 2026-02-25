import type { TFunction } from '../../types/utility.types.js';
import type { EntityTarget } from '../common/EntityTarget.js';

/**
 * Arguments for EntityRepositoryMetadata class, helps to construct an EntityRepositoryMetadata object.
 */
export interface EntityRepositoryMetadataArgs {
  /**
   * Constructor of the custom entity repository.
   */
  readonly target: TFunction;

  /**
   * Entity managed by this custom repository.
   */
  readonly entity?: EntityTarget<unknown>;
}
