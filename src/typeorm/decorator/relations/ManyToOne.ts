import type { ObjectType } from '../../common/ObjectType.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { RelationMetadataArgs } from '../../metadata-args/RelationMetadataArgs.js';
import { ObjectUtils } from '../../util/ObjectUtils.js';
import type { RelationOptions } from '../options/RelationOptions.js';

/**
 * A many-to-one relation allows creating the type of relation where Entity1 can have a single instance of Entity2, but
 * Entity2 can have multiple instances of Entity1. Entity1 is the owner of the relationship, and stores the id of
 * Entity2 on its side of the relation.
 */
export function ManyToOne<T>(
  typeFunctionOrTarget: string | ((type?: unknown) => ObjectType<T>),
  options?: RelationOptions
): PropertyDecorator;

/**
 * A many-to-one relation allows creating the type of relation where Entity1 can have a single instance of Entity2, but
 * Entity2 can have multiple instances of Entity1. Entity1 is the owner of the relationship, and stores the id of
 * Entity2 on its side of the relation.
 */
export function ManyToOne<T>(
  typeFunctionOrTarget: string | ((type?: unknown) => ObjectType<T>),
  inverseSide?: string | ((object: T) => unknown),
  options?: RelationOptions
): PropertyDecorator;

/**
 * A many-to-one relation allows creating the type of relation where Entity1 can have a single instance of Entity2, but
 * Entity2 can have multiple instances of Entity1. Entity1 is the owner of the relationship, and stores the id of
 * Entity2 on its side of the relation.
 */
export function ManyToOne<T>(
  typeFunctionOrTarget: string | ((type?: unknown) => ObjectType<T>),
  inverseSideOrOptions?: string | ((object: T) => unknown) | RelationOptions,
  options?: RelationOptions
): PropertyDecorator {
  // Normalize parameters.
  let inverseSideProperty: string | ((object: T) => unknown);
  if (ObjectUtils.isObject(inverseSideOrOptions)) {
    options = inverseSideOrOptions as RelationOptions;
  } else {
    inverseSideProperty = inverseSideOrOptions as string;
  }

  return function (object: object, propertyName: string | symbol) {
    if (!options) options = {} as RelationOptions;

    // Now try to determine if it is a lazy relation.
    let isLazy = options && options.lazy === true;
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
      relationType: 'many-to-one',
      isLazy: isLazy,
      type: typeFunctionOrTarget,
      inverseSideProperty: inverseSideProperty,
      options: options,
    } as RelationMetadataArgs);
  };
}
