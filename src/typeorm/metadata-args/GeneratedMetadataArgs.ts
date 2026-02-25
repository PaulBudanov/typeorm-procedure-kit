import type { TFunction } from '../../types/utility.types.js';

/**
 * Arguments for Generated decorator class.
 */
export interface GeneratedMetadataArgs {
  /**
   * Class to which decorator is applied.
   */
  readonly target: TFunction | string;

  /**
   * Class's property name to which decorator is applied.
   */
  readonly propertyName: string;

  /**
   * Generation strategy.
   */
  readonly strategy: 'uuid' | 'increment' | 'rowid';
}
