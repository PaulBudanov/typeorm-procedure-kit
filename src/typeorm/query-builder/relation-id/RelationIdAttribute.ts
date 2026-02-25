import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import { TypeORMError } from '../../error/TypeORMError.js';
import { EntityMetadata } from '../../metadata/EntityMetadata.js';
import { RelationMetadata } from '../../metadata/RelationMetadata.js';
import { ObjectUtils } from '../../util/ObjectUtils.js';
import { QueryBuilderUtils } from '../QueryBuilderUtils.js';
import { QueryExpressionMap } from '../QueryExpressionMap.js';
import { SelectQueryBuilder } from '../SelectQueryBuilder.js';

/**
 * Stores all join relation id attributes which will be used to build a JOIN query.
 */
export class RelationIdAttribute {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Alias of the joined (destination) table.
   */
  public alias?: string;

  /**
   * Name of relation.
   */
  public relationName!: string;

  /**
   * Property + alias of the object where to joined data should be mapped.
   */
  public mapToProperty!: string;

  /**
   * Extra condition applied to "ON" section of join.
   */
  public queryBuilderFactory?: (
    qb: SelectQueryBuilder<ObjectLiteral>
  ) => SelectQueryBuilder<ObjectLiteral>;

  /**
   * Indicates if relation id should NOT be loaded as id map.
   */
  public disableMixedMap = false;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    private queryExpressionMap: QueryExpressionMap,
    relationIdAttribute?: Partial<RelationIdAttribute>
  ) {
    ObjectUtils.assign(this, relationIdAttribute || {});
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public get joinInverseSideMetadata(): EntityMetadata {
    return this.relation.inverseEntityMetadata;
  }

  /**
   * Alias of the parent of this join.
   * For example, if we join ("post.category", "categoryAlias") then "post" is a parent alias.
   * This value is extracted from entityOrProperty value.
   * This is available when join was made using "post.category" syntax.
   */
  public get parentAlias(): string {
    if (!QueryBuilderUtils.isAliasProperty(this.relationName))
      throw new TypeORMError(
        `Given value must be a string representation of alias property`
      );

    return this.relationName.substr(0, this.relationName.indexOf('.'));
  }

  /**
   * Relation property name of the parent.
   * This is used to understand what is joined.
   * For example, if we join ("post.category", "categoryAlias") then "category" is a relation property.
   * This value is extracted from entityOrProperty value.
   * This is available when join was made using "post.category" syntax.
   */
  public get relationPropertyPath(): string {
    if (!QueryBuilderUtils.isAliasProperty(this.relationName))
      throw new TypeORMError(
        `Given value must be a string representation of alias property`
      );

    return this.relationName.substr(this.relationName.indexOf('.') + 1);
  }

  /**
   * Relation of the parent.
   * This is used to understand what is joined.
   * This is available when join was made using "post.category" syntax.
   */
  public get relation(): RelationMetadata {
    if (!QueryBuilderUtils.isAliasProperty(this.relationName))
      throw new TypeORMError(
        `Given value must be a string representation of alias property`
      );

    const relationOwnerSelection = this.queryExpressionMap.findAliasByName(
      this.parentAlias!
    );
    const relation =
      relationOwnerSelection.metadata.findRelationWithPropertyPath(
        this.relationPropertyPath!
      );
    if (!relation)
      throw new TypeORMError(
        `Relation with property path ${this.relationPropertyPath} in entity was not found.`
      );
    return relation;
  }

  /**
   * Generates alias of junction table, whose ids we get.
   */
  public get junctionAlias(): string {
    const [parentAlias, relationProperty] = this.relationName.split('.');
    return parentAlias + '_' + relationProperty + '_rid';
  }

  /**
   * Metadata of the joined entity.
   * If extra condition without entity was joined, then it will return undefined.
   */
  public get junctionMetadata(): EntityMetadata {
    return this.relation.junctionEntityMetadata!;
  }

  public get mapToPropertyParentAlias(): string {
    return this.mapToProperty.substr(0, this.mapToProperty.indexOf('.'));
  }

  public get mapToPropertyPropertyPath(): string {
    return this.mapToProperty.substr(this.mapToProperty.indexOf('.') + 1);
  }
}
