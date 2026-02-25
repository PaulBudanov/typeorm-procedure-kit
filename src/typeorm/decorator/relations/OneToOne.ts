import type { ObjectType } from '../../common/ObjectType.js';
import { getMetadataArgsStorage } from '../../globals.js';
import type { RelationMetadataArgs } from '../../metadata-args/RelationMetadataArgs.js';
import { ObjectUtils } from '../../util/ObjectUtils.js';
import type { RelationOptions } from '../options/RelationOptions.js';

/**
 * One-to-one relation allows the creation of a direct relation between two entities. Entity1 has only one Entity2.
 * Entity1 is the owner of the relationship, and stores Entity2 id on its own side.
 */
export function OneToOne<T>(
  typeOrTarget: string | ((type?: unknown) => ObjectType<T>),
  options?: RelationOptions
): PropertyDecorator;

/**
 * One-to-one relation allows the creation of a direct relation between two entities. Entity1 has only one Entity2.
 * Entity1 is the owner of the relationship, and stores Entity2 id on its own side.
 */
export function OneToOne<T>(
  typeOrTarget: string | ((type?: unknown) => ObjectType<T>),
  inverseSide?: string | ((object: T) => unknown),
  options?: RelationOptions
): PropertyDecorator;

/**
 * One-to-one relation allows the creation of a direct relation between two entities. Entity1 has only one Entity2.
 * Entity1 is the owner of the relationship, and stores Entity2 id on its own side.
 */
export function OneToOne<T>(
  typeOrTarget: string | ((type?: unknown) => ObjectType<T>),
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
    let isLazy = options && options.lazy === true ? true : false;
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
      isLazy: isLazy,
      relationType: 'one-to-one',
      type: typeOrTarget,
      inverseSideProperty: inverseSideProperty,
      options: options,
    } as RelationMetadataArgs);
  };
}
