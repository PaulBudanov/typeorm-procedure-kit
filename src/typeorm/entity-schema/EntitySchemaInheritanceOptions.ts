import type { ColumnOptions } from '../decorator/options/ColumnOptions.js';

export interface EntitySchemaInheritanceOptions {
  /**
   * Inheritance pattern.
   */
  pattern?: 'STI';

  /**
   * Inheritance discriminator column.
   */
  column?: string | ColumnOptions;
}
