import { getMetadataArgsStorage } from '../../globals.js';
import type { ClosureTreeOptions } from '../../metadata/types/ClosureTreeOptions.js';
import type { TreeType } from '../../metadata/types/TreeTypes.js';
import type { TreeMetadataArgs } from '../../metadata-args/TreeMetadataArgs.js';

/**
 * Marks entity to work like a tree.
 * Tree pattern that will be used for the tree entity should be specified.
 * @TreeParent decorator must be used in tree entities.
 * TreeRepository can be used to manipulate with tree entities.
 */
export function Tree(
  type: TreeType,
  options?: ClosureTreeOptions
): ClassDecorator {
  return function (target) {
    getMetadataArgsStorage().trees.push({
      target: target,
      type: type,
      options: type === 'closure-table' ? options : undefined,
    } as TreeMetadataArgs);
  };
}
