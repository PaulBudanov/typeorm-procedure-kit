import type { TFunction } from '../../types/utility.types.js';
import type { EventListenerType } from '../metadata/types/EventListenerTypes.js';

/**
 * Arguments for EntityListenerMetadata class.
 */
export interface EntityListenerMetadataArgs {
  /**
   * Class to which listener is applied.
   */
  readonly target: TFunction;

  /**
   * Class's property name to which listener is applied.
   */
  readonly propertyName: string;

  /**
   * The type of the listener.
   */
  readonly type: EventListenerType;
}
