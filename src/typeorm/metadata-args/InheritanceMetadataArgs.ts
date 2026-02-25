import type { TFunction } from '../../types/utility.types.js';
import type { ColumnOptions } from '../decorator/options/ColumnOptions.js';

/**
 * Arguments for InheritanceMetadata class.
 */
export interface InheritanceMetadataArgs {
  /**
   * Class to which inheritance is applied.
   */
  readonly target?: TFunction | string;

  /**
   * Inheritance pattern.
   */
  readonly pattern: 'STI'; /*|"CTI"*/

  /**
   * Column used as inheritance discriminator column.
   */
  readonly column?: ColumnOptions;
}
