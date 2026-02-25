import type { TFunction } from '../../types/utility.types.js';
import type { CheckMetadataArgs } from '../metadata-args/CheckMetadataArgs.js';
import type { NamingStrategyInterface } from '../naming-strategy/NamingStrategyInterface.js';

import { EntityMetadata } from './EntityMetadata.js';

/**
 * Check metadata contains all information about table's check constraints.
 */
export class CheckMetadata {
  // ---------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata of the class to which this check constraint is applied.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Target class to which metadata is applied.
   */
  public target?: TFunction | string;

  /**
   * Check expression.
   */
  public expression!: string;

  /**
   * User specified check constraint name.
   */
  public givenName?: string;

  /**
   * Final check constraint name.
   * If check constraint name was given by a user then it stores normalized (by naming strategy) givenName.
   * If check constraint name was not given then its generated.
   */
  public name!: string;

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    args?: CheckMetadataArgs;
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
   * Builds some depend check constraint properties.
   * Must be called after all entity metadata's properties map, columns and relations are built.
   */
  public build(namingStrategy: NamingStrategyInterface): this {
    this.name = this.givenName
      ? this.givenName
      : namingStrategy.checkConstraintName(
          this.entityMetadata.tableName,
          this.expression
        );
    return this;
  }
}
