import { getMetadataArgsStorage } from '../../globals.js';
import type { EntitySubscriberMetadataArgs } from '../../metadata-args/EntitySubscriberMetadataArgs.js';

/**
 * Classes decorated with this decorator will listen to ORM events and their methods will be triggered when event
 * occurs. Those classes must implement EventSubscriberInterface interface.
 */
export function EventSubscriber(): ClassDecorator {
  return function (target): void {
    getMetadataArgsStorage().entitySubscribers.push({
      target,
    } as unknown as EntitySubscriberMetadataArgs);
  };
}
