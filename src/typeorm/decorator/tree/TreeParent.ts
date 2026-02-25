import { getMetadataArgsStorage } from '../../globals.js';
import type { OnDeleteType } from '../../metadata/types/OnDeleteType.js';
import type { RelationMetadataArgs } from '../../metadata-args/RelationMetadataArgs.js';
import type { RelationOptions } from '../options/RelationOptions.js';

/**
 * Marks an entity property as a parent of the tree.
 * "Tree parent" indicates who owns (is a parent) of this entity in tree structure.
 */
export function TreeParent(options?: {
  onDelete?: OnDeleteType;
}): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    if (!options) options = {} as RelationOptions;

    // now try to determine it its lazy relation
    const reflectedType =
      Reflect && (Reflect as Record<string, unknown>).getMetadata
        ? (Reflect.getMetadata('design:type', object, propertyName) as Record<
            string,
            unknown
          >)
        : undefined;
    const isLazy =
      (reflectedType &&
        typeof reflectedType.name === 'string' &&
        reflectedType.name.toLowerCase() === 'promise') ||
      false;

    getMetadataArgsStorage().relations.push({
      isTreeParent: true,
      target: object.constructor,
      propertyName: propertyName.toString(),
      isLazy: isLazy,
      relationType: 'many-to-one',
      type: () => object.constructor,
      options: options,
    } as RelationMetadataArgs);
  };
}
