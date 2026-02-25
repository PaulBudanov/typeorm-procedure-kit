import { getMetadataArgsStorage } from '../../globals.js';
import { EventListenerTypes } from '../../metadata/types/EventListenerTypes.js';
import type { EntityListenerMetadataArgs } from '../../metadata-args/EntityListenerMetadataArgs.js';

// Type alias to avoid ESLint no-unsafe-function-type
type AnyFunction = (...args: Array<unknown>) => unknown;

/**
 * Calls a method on which this decorator is applied before this entity soft removal.
 */
export function AfterRecover(): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    getMetadataArgsStorage().entityListeners.push({
      target: object.constructor as unknown as AnyFunction,
      propertyName:
        typeof propertyName === 'symbol'
          ? propertyName.toString()
          : propertyName,
      type: EventListenerTypes.AFTER_RECOVER,
    } as unknown as EntityListenerMetadataArgs);
  };
}
