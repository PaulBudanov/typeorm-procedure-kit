import { getMetadataArgsStorage } from '../globals.js';
import type { GeneratedMetadataArgs } from '../metadata-args/GeneratedMetadataArgs.js';

/**
 * Marks a column to generate a value on entity insertion.
 * Supported strategies:
 * - increment: uses a number which increases by one on each insertion (Oracle, PostgreSQL)
 * - uuid: generates a special UUID token (Oracle, PostgreSQL)
 *
 * Note: 'rowid' strategy is not supported as it's CockroachDB-specific.
 */
export function Generated(
  strategy: 'increment' | 'uuid' = 'increment'
): PropertyDecorator {
  return function (object: object, propertyName: string | symbol): void {
    getMetadataArgsStorage().generations.push({
      target: object.constructor,
      propertyName: propertyName.toString(),
      strategy: strategy,
    } as GeneratedMetadataArgs);
  };
}
