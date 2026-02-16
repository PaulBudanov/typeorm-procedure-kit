import type { TFunction } from '../../types/utility.types.js';
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';

/**
 * Arguments for RelationIdMetadataArgs class.
 */
export interface RelationIdMetadataArgs {
  /**
   * Class to which this decorator is applied.
   */
  readonly target: TFunction | string;

  /**
   * Class's property name to which this decorator is applied.
   */
  readonly propertyName: string;

  /**
   * Target's relation which it should count.
   */
  readonly relation: string | ((object: unknown) => unknown);

  /**
   * Alias of the joined (destination) table.
   */
  readonly alias?: string;

  /**
   * Extra condition applied to "ON" section of join.
   */
  readonly queryBuilderFactory?: (
    qb: SelectQueryBuilder<unknown>
  ) => SelectQueryBuilder<unknown>;
}
