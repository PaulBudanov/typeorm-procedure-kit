import type { EntitySchema } from './EntitySchema.js';

export class EntitySchemaEmbeddedColumnOptions {
  /**
   * Schema of embedded entity
   */
  public schema!: EntitySchema;

  /**
   * Embedded column prefix.
   * If set to empty string or false, then prefix is not set at all.
   */
  public prefix?: string | boolean;

  /**
   * Indicates if this embedded is in array mode.
   *
   * This option works only in mongodb.
   */
  public array?: boolean;
}
