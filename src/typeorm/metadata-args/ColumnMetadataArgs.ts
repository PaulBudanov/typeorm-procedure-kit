import type { TFunction } from '../../types/utility.types.js';
import type { ColumnOptions } from '../decorator/options/ColumnOptions.js';

import type { ColumnMode } from './types/ColumnMode.js';

/**
 * Arguments for ColumnMetadata class.
 */
export interface ColumnMetadataArgs {
  /**
   * Class to which column is applied.
   */
  readonly target: TFunction | string;

  /**
   * Class's property name to which column is applied.
   */
  readonly propertyName: string;

  /**
   * Column mode in which column will work.
   *
   * todo: find name better then "mode".
   */
  readonly mode: ColumnMode;

  /**
   * Extra column options.
   */
  readonly options: ColumnOptions;
}
