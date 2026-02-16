import type { EntitySchema } from '../entity-schema/EntitySchema.js';

import type { ObjectType } from './ObjectType.js';

/**
 * Entity target.
 */
export type EntityTarget<Entity> =
  | ObjectType<Entity>
  | EntitySchema<Entity>
  | string
  | { type: Entity; name: string };
