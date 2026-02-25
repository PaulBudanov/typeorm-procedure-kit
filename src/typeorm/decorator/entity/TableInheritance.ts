import { getMetadataArgsStorage } from '../../globals.js';
import type { InheritanceMetadataArgs } from '../../metadata-args/InheritanceMetadataArgs.js';
import type { ColumnOptions } from '../options/ColumnOptions.js';

/**
 * Sets for entity to use table inheritance pattern.
 */
export function TableInheritance(options?: {
  pattern?: 'STI'; /*|"CTI"*/
  column?: string | ColumnOptions;
}): ClassDecorator {
  return function (target): void {
    getMetadataArgsStorage().inheritances.push({
      target,
      pattern: options?.pattern ?? 'STI',
      column: options?.column
        ? typeof options.column === 'string'
          ? { name: options.column }
          : options.column
        : undefined,
    } as unknown as InheritanceMetadataArgs);
  };
}
