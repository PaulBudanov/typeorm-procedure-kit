import type { TFunction } from '../../types/utility.types.js';
import type { ExclusionMetadataArgs } from '../metadata-args/ExclusionMetadataArgs.js';
import type { NamingStrategyInterface } from '../naming-strategy/NamingStrategyInterface.js';

import { EntityMetadata } from './EntityMetadata.js';

/**
 * Exclusion metadata contains all information about table's exclusion constraints.
 */
export class ExclusionMetadata {
  // ---------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata of the class to which this exclusion constraint is applied.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Target class to which metadata is applied.
   */
  public target?: TFunction | string;

  /**
   * Exclusion expression.
   */
  public expression!: string;

  /**
   * User specified exclusion constraint name.
   */
  public givenName?: string;

  /**
   * Final exclusion constraint name.
   * If exclusion constraint name was given by a user then it stores normalized (by naming strategy) givenName.
   * If exclusion constraint name was not given then its generated.
   */
  public name!: string;

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    args?: ExclusionMetadataArgs;
  }) {
    this.entityMetadata = options.entityMetadata;

    if (options.args) {
      this.target = options.args.target;
      this.expression = options.args.expression;
      this.givenName = options.args.name;
    }
  }

  // ---------------------------------------------------------------------
  // Public Build Methods
  // ---------------------------------------------------------------------

  /**
   * Builds some depend exclusion constraint properties.
   * Must be called after all entity metadata's properties map, columns and relations are built.
   */
  public build(namingStrategy: NamingStrategyInterface): this {
    this.name = this.givenName
      ? this.givenName
      : namingStrategy.exclusionConstraintName(
          this.entityMetadata.tableName,
          this.expression
        );
    return this;
  }
}
