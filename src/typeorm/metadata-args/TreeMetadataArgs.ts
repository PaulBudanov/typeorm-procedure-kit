import type { TFunction } from '../../types/utility.types.js';
import type { ClosureTreeOptions } from '../metadata/types/ClosureTreeOptions.js';
import type { TreeType } from '../metadata/types/TreeTypes.js';

/**
 * Stores metadata collected for Tree entities.
 */
export interface TreeMetadataArgs {
  /**
   * Entity to which tree is applied.
   */
  target: TFunction | string;

  /**
   * Tree type.
   */
  type: TreeType;

  /**
   * Tree options
   */
  options?: ClosureTreeOptions;
}
