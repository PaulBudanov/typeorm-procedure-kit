import type { DeferrableType } from '../../metadata/types/DeferrableType.js';
import type { OnDeleteType } from '../../metadata/types/OnDeleteType.js';
import type { OnUpdateType } from '../../metadata/types/OnUpdateType.js';

/**
 * Describes all foreign key options.
 */
export interface ForeignKeyOptions {
  /**
   * Name of the foreign key constraint.
   */
  name?: string;

  /**
   * Database cascade action on delete.
   */
  onDelete?: OnDeleteType;

  /**
   * Database cascade action on update.
   */
  onUpdate?: OnUpdateType;

  /**
   * Indicate if foreign key constraints can be deferred.
   */
  deferrable?: DeferrableType;
}
