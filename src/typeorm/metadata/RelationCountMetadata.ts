import type { TFunction } from '../../types/utility.types.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { RelationCountMetadataArgs } from '../metadata-args/RelationCountMetadataArgs.js';
import { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';

import { EntityMetadata } from './EntityMetadata.js';
import { RelationMetadata } from './RelationMetadata.js';

/**
 * Contains all information about entity's relation count.
 */
export class RelationCountMetadata {
  // ---------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata where this column metadata is.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Relation which needs to be counted.
   */
  public relation!: RelationMetadata;

  /**
   * Relation name which need to count.
   */
  public relationNameOrFactory: string | ((object: unknown) => unknown);

  /**
   * Target class to which metadata is applied.
   */
  public target: TFunction | string;

  /**
   * Target's property name to which this metadata is applied.
   */
  public propertyName: string;

  /**
   * Alias of the joined (destination) table.
   */
  public alias?: string;

  /**
   * Extra condition applied to "ON" section of join.
   */
  public queryBuilderFactory?: (
    qb: SelectQueryBuilder<unknown>
  ) => SelectQueryBuilder<unknown>;

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    args: RelationCountMetadataArgs;
  }) {
    this.entityMetadata = options.entityMetadata;
    this.target = options.args.target;
    this.propertyName = options.args.propertyName;
    this.relationNameOrFactory = options.args.relation;
    this.alias = options.args.alias;
    this.queryBuilderFactory = options.args.queryBuilderFactory;
  }

  // ---------------------------------------------------------------------
  // Public Builder Methods
  // ---------------------------------------------------------------------

  /**
   * Builds some depend relation count metadata properties.
   * This builder method should be used only after entity metadata, its properties map and all relations are build.
   */
  public build(): void {
    const propertyPath =
      typeof this.relationNameOrFactory === 'function'
        ? this.relationNameOrFactory(this.entityMetadata.propertiesMap)
        : this.relationNameOrFactory;
    const relation = this.entityMetadata.findRelationWithPropertyPath(
      propertyPath as string
    );
    if (!relation)
      throw new TypeORMError(
        `Cannot find relation ${propertyPath}. Wrong relation specified for @RelationCount decorator.`
      );

    this.relation = relation;
  }
}
