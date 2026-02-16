import { EntitySchemaOptions } from './EntitySchemaOptions.js';

/**
 * Interface for entity metadata mappings stored inside "schemas" instead of models decorated by decorators.
 */
export class EntitySchema<T = unknown> {
  public readonly '@instanceof' = Symbol.for('EntitySchema');

  public constructor(public options: EntitySchemaOptions<T>) {}
}
