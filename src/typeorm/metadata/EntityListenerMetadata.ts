import type { TFunction } from '../../types/utility.types.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { EntityListenerMetadataArgs } from '../metadata-args/EntityListenerMetadataArgs.js';

import { EmbeddedMetadata } from './EmbeddedMetadata.js';
import { EntityMetadata } from './EntityMetadata.js';
import type { EventListenerType } from './types/EventListenerTypes.js';

/**
 * This metadata contains all information about entity's listeners.
 */
export class EntityListenerMetadata {
  // ---------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata of the listener.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Embedded metadata of the listener, in the case if listener is in embedded.
   */
  public embeddedMetadata?: EmbeddedMetadata;

  /**
   * Target class to which metadata is applied.
   * This can be different then entityMetadata.target in the case if listener is in the embedded.
   */
  public target: TFunction | string;

  /**
   * Target's property name to which this metadata is applied.
   */
  public propertyName: string;

  /**
   * The type of the listener.
   */
  public type: EventListenerType;

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    embeddedMetadata?: EmbeddedMetadata;
    args: EntityListenerMetadataArgs;
  }) {
    this.entityMetadata = options.entityMetadata;
    this.embeddedMetadata = options.embeddedMetadata;
    this.target = options.args.target;
    this.propertyName = options.args.propertyName;
    this.type = options.args.type;
  }

  // ---------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------

  /**
   * Checks if entity listener is allowed to be executed on the given entity.
   */
  public isAllowed(entity: ObjectLiteral): boolean {
    // todo: create in entity metadata method like isInherited?
    return (
      this.entityMetadata.target === entity.constructor || // todo: .constructor won't work for entity schemas, but there are no entity listeners in schemas since there are no objects, right?
      (typeof this.entityMetadata.target === 'function' &&
        entity.constructor.prototype instanceof this.entityMetadata.target)
    ); // todo: also need to implement entity schema inheritance
  }

  /**
   * Executes listener method of the given entity.
   */
  public execute(entity: ObjectLiteral): unknown {
    // Check if the Embedded Metadata does not exist
    if (!this.embeddedMetadata) {
      // Get the Entity's Method
      const entityMethod = entity[this.propertyName];

      // Check if the Entity Method does not exist
      if (!entityMethod)
        throw new Error(
          `Entity listener method "${this.propertyName}" does not exist in entity "${entity.constructor.name}".`
        );

      // Check if the Entity Method is not a function
      if (typeof entityMethod !== 'function')
        throw new Error(
          `Entity listener method "${this.propertyName}" in entity "${
            entity.constructor.name
          }" must be a function but got "${typeof entityMethod}".`
        );

      // Call and return the Entity Method
      return entityMethod.call(entity);
    }

    // Call the Embedded Method
    this.callEntityEmbeddedMethod(
      entity,
      this.embeddedMetadata.propertyPath.split('.')
    );
  }

  // ---------------------------------------------------------------------
  // Protected Methods
  // ---------------------------------------------------------------------

  /**
   * Calls embedded entity listener method no matter how nested it is.
   */
  protected callEntityEmbeddedMethod(
    entity: ObjectLiteral,
    propertyPaths: Array<string>
  ): void {
    const propertyPath = propertyPaths.shift();
    if (!propertyPath || !entity[propertyPath]) return;

    if (propertyPaths.length === 0) {
      if (Array.isArray(entity[propertyPath])) {
        entity[propertyPath].map((embedded: ObjectLiteral) =>
          (embedded[this.propertyName] as TFunction)()
        );
      } else {
        (
          (entity[propertyPath as keyof typeof entity] as ObjectLiteral)[
            this.propertyName
          ] as TFunction
        )();
      }
    } else {
      if (entity[propertyPath])
        this.callEntityEmbeddedMethod(
          entity[propertyPath] as ObjectLiteral,
          propertyPaths
        );
    }
  }
}
