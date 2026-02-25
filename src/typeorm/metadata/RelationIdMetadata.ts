import type { TFunction } from '../../types/utility.types.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { RelationIdMetadataArgs } from '../metadata-args/RelationIdMetadataArgs.js';
import { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';

import { EntityMetadata } from './EntityMetadata.js';
import { RelationMetadata } from './RelationMetadata.js';

/**
 * Contains all information about entity's relation count.
 */
export class RelationIdMetadata {
  // ---------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata where this column metadata is.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Relation from which ids will be extracted.
   */
  public relation!: RelationMetadata;

  /**
   * Relation name which need to count.
   */
  public relationNameOrFactory: string | ((object: ObjectLiteral) => unknown);

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
    qb: SelectQueryBuilder<ObjectLiteral>
  ) => SelectQueryBuilder<ObjectLiteral>;

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    args: RelationIdMetadataArgs;
  }) {
    this.entityMetadata = options.entityMetadata;
    this.target = options.args.target;
    this.propertyName = options.args.propertyName;
    this.relationNameOrFactory = options.args.relation;
    this.alias = options.args.alias;
    this.queryBuilderFactory = options.args.queryBuilderFactory;
  }

  // ---------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------

  /**
   * Sets relation id value from the given entity.
   *
   * todo: make it to work in embeds as well.
   */
  public setValue(entity: ObjectLiteral): void {
    const inverseEntity = this.relation.getEntityValue(entity);

    if (Array.isArray(inverseEntity)) {
      entity[this.propertyName] = inverseEntity
        .map((item) => {
          return this.relation.inverseEntityMetadata.getEntityIdMixedMap(
            item as ObjectLiteral | undefined
          );
        })
        .filter((item) => item !== null && item !== undefined);
    } else {
      const value =
        this.relation.inverseEntityMetadata.getEntityIdMixedMap(inverseEntity);
      if (value !== undefined) entity[this.propertyName] = value;
    }
  }

  // ---------------------------------------------------------------------
  // Public Builder Methods
  // ---------------------------------------------------------------------

  /**
   * Builds some depend relation id properties.
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
        `Cannot find relation ${propertyPath}. Wrong relation specified for @RelationId decorator.`
      );

    this.relation = relation;
  }
}
