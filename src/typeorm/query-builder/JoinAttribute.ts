import type { TFunction } from '../../types/utility.types.js';
import { DataSource } from '../data-source/DataSource.js';
import { DriverUtils } from '../driver/DriverUtils.js';
import { TypeORMError } from '../error/TypeORMError.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { Alias } from './Alias.js';
import { QueryBuilderUtils } from './QueryBuilderUtils.js';
import { QueryExpressionMap } from './QueryExpressionMap.js';

/**
 * Stores all join attributes which will be used to build a JOIN query.
 */
export class JoinAttribute {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Join direction.
   */
  public direction!: 'LEFT' | 'INNER';

  /**
   * Alias of the joined (destination) table.
   */
  public alias!: Alias;

  /**
   * Joined table, entity target, or relation in "post.category" format.
   */
  public entityOrProperty!: TFunction | string;

  /**
   * Extra condition applied to "ON" section of join.
   */
  public condition?: string;

  /**
   * Property + alias of the object where to joined data should be mapped.
   */
  public mapToProperty?: string;

  /**
   * Indicates if user maps one or many objects from the join.
   */
  public isMappingMany?: boolean;

  /**
   * Useful when the joined expression is a custom query to support mapping.
   */
  public mapAsEntity?: TFunction | string;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    private connection: DataSource,
    private queryExpressionMap: QueryExpressionMap,
    joinAttribute?: JoinAttribute
  ) {
    if (joinAttribute) {
      ObjectUtils.assign(this, joinAttribute);
    }
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public get isMany(): boolean {
    if (this.isMappingMany !== undefined) return this.isMappingMany;

    if (this.relation)
      return this.relation.isManyToMany || this.relation.isOneToMany;

    return false;
  }

  public isSelectedCache!: boolean;
  public isSelectedEvaluated = false;
  /**
   * Indicates if this join is selected.
   */
  public get isSelected(): boolean {
    if (!this.isSelectedEvaluated) {
      const getValue = (): boolean => {
        for (const select of this.queryExpressionMap.selects) {
          if (select.selection === this.alias.name) return true;

          if (
            this.metadata &&
            !!this.metadata.columns.find(
              (column) =>
                select.selection === this.alias.name + '.' + column.propertyPath
            )
          )
            return true;
        }

        return false;
      };
      this.isSelectedCache = getValue();
      this.isSelectedEvaluated = true;
    }
    return this.isSelectedCache;
  }

  /**
   * Name of the table which we should join.
   */
  public get tablePath(): string {
    return this.metadata
      ? this.metadata.tablePath
      : (this.entityOrProperty as string);
  }

  /**
   * Alias of the parent of this join.
   * For example, if we join ("post.category", "categoryAlias") then "post" is a parent alias.
   * This value is extracted from entityOrProperty value.
   * This is available when join was made using "post.category" syntax.
   */
  public get parentAlias(): string | undefined {
    if (!QueryBuilderUtils.isAliasProperty(this.entityOrProperty as string))
      return undefined;

    return (this.entityOrProperty as string).substr(
      0,
      (this.entityOrProperty as string).indexOf('.')
    );
  }

  /**
   * Relation property name of the parent.
   * This is used to understand what is joined.
   * For example, if we join ("post.category", "categoryAlias") then "category" is a relation property.
   * This value is extracted from entityOrProperty value.
   * This is available when join was made using "post.category" syntax.
   */
  public get relationPropertyPath(): string | undefined {
    if (!QueryBuilderUtils.isAliasProperty(this.entityOrProperty as string))
      return undefined;

    return (this.entityOrProperty as string).substr(
      (this.entityOrProperty as string).indexOf('.') + 1
    );
  }

  public relationCache: RelationMetadata | undefined;
  public relationEvaluated = false;
  /**
   * Relation of the parent.
   * This is used to understand what is joined.
   * This is available when join was made using "post.category" syntax.
   * Relation can be undefined if entityOrProperty is regular entity or custom table.
   */
  public get relation(): RelationMetadata | undefined {
    if (!this.relationEvaluated) {
      const getValue = (): RelationMetadata | undefined => {
        if (!QueryBuilderUtils.isAliasProperty(this.entityOrProperty as string))
          return undefined;

        const relationOwnerSelection = this.queryExpressionMap.findAliasByName(
          this.parentAlias!
        );
        let relation =
          relationOwnerSelection.metadata.findRelationWithPropertyPath(
            this.relationPropertyPath!
          );

        if (relation) {
          return relation;
        }

        if (relationOwnerSelection.metadata.parentEntityMetadata) {
          relation =
            relationOwnerSelection.metadata.parentEntityMetadata.findRelationWithPropertyPath(
              this.relationPropertyPath!
            );
          if (relation) {
            return relation;
          }
        }

        throw new TypeORMError(
          `Relation with property path ${this.relationPropertyPath} in entity was not found.`
        );
      };
      this.relationCache = getValue.bind(this)();
      this.relationEvaluated = true;
    }
    return this.relationCache;
  }

  /**
   * Metadata of the joined entity.
   * If table without entity was joined, then it will return undefined.
   */
  public get metadata(): EntityMetadata | undefined {
    // entityOrProperty is relation, e.g. "post.category"
    if (this.relation) return this.relation.inverseEntityMetadata;

    // entityOrProperty is Entity class
    if (this.connection.hasMetadata(this.entityOrProperty))
      return this.connection.getMetadata(this.entityOrProperty);

    // Overriden mapping entity provided for leftJoinAndMapOne with custom query builder
    if (this.mapAsEntity && this.connection.hasMetadata(this.mapAsEntity)) {
      return this.connection.getMetadata(this.mapAsEntity);
    }

    return undefined;

    /*if (typeof this.entityOrProperty === "string") { // entityOrProperty is a custom table

            // first try to find entity with such name, this is needed when entity does not have a target class,
            // and its target is a string name (scenario when plain old javascript is used or entity schema is loaded from files)
            const metadata = this.connection.entityMetadatas.find(metadata => metadata.name === this.entityOrProperty);
            if (metadata)
                return metadata;

            // check if we have entity with such table name, and use its metadata if found
            return this.connection.entityMetadatas.find(metadata => metadata.tableName === this.entityOrProperty);
        }*/
  }

  /**
   * Generates alias of junction table, whose ids we get.
   */
  public get junctionAlias(): string {
    if (!this.relation) {
      throw new TypeORMError(
        `Cannot get junction table for join without relation.`
      );
    }
    if (typeof this.entityOrProperty !== 'string') {
      throw new TypeORMError(`Junction property is not defined.`);
    }

    const aliasProperty = this.entityOrProperty.substr(
      0,
      this.entityOrProperty.indexOf('.')
    );

    if (this.relation.isOwning) {
      return DriverUtils.buildAlias(
        this.connection.driver,
        undefined,
        aliasProperty,
        this.alias.name
      );
    } else {
      return DriverUtils.buildAlias(
        this.connection.driver,
        undefined,
        this.alias.name,
        aliasProperty
      );
    }
  }

  public get mapToPropertyParentAlias(): string | undefined {
    if (!this.mapToProperty) return undefined;

    return this.mapToProperty!.split('.')[0];
  }

  public get mapToPropertyPropertyName(): string | undefined {
    if (!this.mapToProperty) return undefined;

    return this.mapToProperty!.split('.')[1];
  }
}
