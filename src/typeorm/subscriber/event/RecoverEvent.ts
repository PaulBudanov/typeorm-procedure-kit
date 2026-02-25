import type { RemoveEvent } from './RemoveEvent.js';

/**
 * RecoverEvent is an object that broadcaster sends to the entity subscriber when entity is being recovered in the database.
 */
export type RecoverEvent<Entity> = RemoveEvent<Entity>;
