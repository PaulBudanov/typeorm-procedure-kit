import { getMetadataArgsStorage } from '../../globals.js';
import type { DiscriminatorValueMetadataArgs } from '../../metadata-args/DiscriminatorValueMetadataArgs.js';
import type { TableMetadataArgs } from '../../metadata-args/TableMetadataArgs.js';

/**
 * Special type of the table used in the single-table inherited tables.
 */
export function ChildEntity(discriminatorValue?: unknown): ClassDecorator {
  return function (target): void {
    // register a table metadata
    getMetadataArgsStorage().tables.push({
      target,
      type: 'entity-child',
    } as unknown as TableMetadataArgs);

    // register discriminator value if it was provided
    if (typeof discriminatorValue !== 'undefined') {
      getMetadataArgsStorage().discriminatorValues.push({
        target,
        value: discriminatorValue,
      } as unknown as DiscriminatorValueMetadataArgs);
    }
  };
}
