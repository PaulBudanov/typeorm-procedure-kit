import type { TFunction } from '../../types/utility.types.js';

/**
 * Metadata args utility functions.
 */
export class MetadataUtils {
  /**
   * Gets given's entity all inherited classes.
   * Gives in order from parents to children.
   * For example Post extends ContentModel which extends Unit it will give
   * [Unit, ContentModel, Post]
   */
  public static getInheritanceTree(entity: TFunction): Array<TFunction> {
    const tree: Array<TFunction> = [entity];
    const getPrototypeOf = (object: TFunction): void => {
      const proto = Object.getPrototypeOf(object) as TFunction;
      if (proto && proto.name) {
        tree.push(proto);
        getPrototypeOf(proto);
      }
    };
    getPrototypeOf(entity);
    return tree;
  }

  /**
   * Checks if this table is inherited from another table.
   */
  public static isInherited(target1: TFunction, target2: TFunction): boolean {
    return target1.prototype instanceof target2;
  }

  /**
   * Filters given array of targets by a given classes.
   * If classes are not given, then it returns array itself.
   */
  public static filterByTarget<T extends { target?: unknown }>(
    array: Array<T>,
    classes?: Array<unknown>
  ): Array<T> {
    if (!classes) return array;
    return array.filter(
      (item) => item.target && classes.indexOf(item.target) !== -1
    );
  }
}
