import type { ObjectType } from '../../common/ObjectType.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { RelationMetadataArgs } from '../../metadata-args/RelationMetadataArgs.js';
import { ObjectUtils } from '../../util/ObjectUtils.js';
import type { RelationOptions } from '../options/RelationOptions.js';

/**
 * Many-to-many is a type of relationship when Entity1 can have multiple instances of Entity2, and Entity2 can have
 * multiple instances of Entity1. To achieve it, this type of relation creates a junction table, where it storage
 * entity1 and entity2 ids. This is owner side of the relationship.
 */
export function ManyToMany<T>(
  typeFunctionOrTarget: string | ((type?: unknown) => ObjectType<T>),
  options?: RelationOptions
): PropertyDecorator;

/**
 * Many-to-many is a type of relationship when Entity1 can have multiple instances of Entity2, and Entity2 can have
 * multiple instances of Entity1. To achieve it, this type of relation creates a junction table, where it storage
 * entity1 and entity2 ids. This is owner side of the relationship.
 */
export function ManyToMany<T>(
  typeFunctionOrTarget: string | ((type?: unknown) => ObjectType<T>),
  inverseSide?: string | ((object: T) => unknown),
  options?: RelationOptions
): PropertyDecorator;

/**
 * Many-to-many is a type of relationship when Entity1 can have multiple instances of Entity2, and Entity2 can have
 * multiple instances of Entity1. To achieve it, this type of relation creates a junction table, where it storage
 * entity1 and entity2 ids. This is owner side of the relationship.
 */
export function ManyToMany<T>(
  typeFunctionOrTarget: string | ((type?: unknown) => ObjectType<T>),
  inverseSideOrOptions?: string | ((object: T) => unknown) | RelationOptions,
  options?: RelationOptions
): PropertyDecorator {
  // normalize parameters
  let inverseSideProperty: string | ((object: T) => unknown);
  if (ObjectUtils.isObject(inverseSideOrOptions)) {
    options = inverseSideOrOptions as RelationOptions;
  } else {
    inverseSideProperty = inverseSideOrOptions as string;
  }

  return function (object: object, propertyName: string | symbol) {
    if (!options) options = {} as RelationOptions;

    // now try to determine it its lazy relation
    let isLazy = options.lazy === true;
    if (!isLazy && Reflect && (Reflect as typeof Reflect).getMetadata) {
      // automatic determination
      const reflectedType = Reflect.getMetadata(
        'design:type',
        object,
        propertyName
      ) as Record<string, unknown>;
      if (
        reflectedType &&
        typeof reflectedType.name === 'string' &&
        reflectedType.name.toLowerCase() === 'promise'
      )
        isLazy = true;
    }

    getMetadataArgsStorage().relations.push({
      target: object.constructor,
      propertyName: propertyName,
      relationType: 'many-to-many',
      isLazy: isLazy,
      type: typeFunctionOrTarget,
      inverseSideProperty: inverseSideProperty,
      options: options,
    } as RelationMetadataArgs);
  };
}
