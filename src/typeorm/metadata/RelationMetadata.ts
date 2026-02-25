import type { TFunction } from '../../types/utility.types.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { EntitySchema } from '../entity-schema/EntitySchema.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { RelationMetadataArgs } from '../metadata-args/RelationMetadataArgs.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { ObjectUtils } from '../util/ObjectUtils.js';

import { ColumnMetadata } from './ColumnMetadata.js';
import { EmbeddedMetadata } from './EmbeddedMetadata.js';
import { EntityMetadata } from './EntityMetadata.js';
import { ForeignKeyMetadata } from './ForeignKeyMetadata.js';
import type { DeferrableType } from './types/DeferrableType.js';
import type { OnDeleteType } from './types/OnDeleteType.js';
import type { OnUpdateType } from './types/OnUpdateType.js';
import type { PropertyTypeFactory } from './types/PropertyTypeInFunction.js';
import type { RelationType } from './types/RelationTypes.js';

/**
 * Contains all information about some entity's relation.
 */
export class RelationMetadata {
  // ---------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata of the entity where this relation is placed.
   *
   * For example for @ManyToMany(type => Category) in Post, entityMetadata will be metadata of Post entity.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Entity metadata of the entity that is targeted by this relation.
   *
   * For example for @ManyToMany(type => Category) in Post, inverseEntityMetadata will be metadata of Category entity.
   */
  public inverseEntityMetadata!: EntityMetadata;

  /**
   * Entity metadata of the junction table.
   * Junction tables have their own entity metadata objects.
   * Defined only for many-to-many relations.
   */
  public junctionEntityMetadata?: EntityMetadata;

  /**
   * Embedded metadata where this relation is.
   * If this relation is not in embed then this property value is undefined.
   */
  public embeddedMetadata?: EmbeddedMetadata;

  /**
   * Relation type, e.g. is it one-to-one, one-to-many, many-to-one or many-to-many.
   */
  public relationType: RelationType;

  /**
   * Target entity to which this relation is applied.
   * Target IS NOT equal to entityMetadata.target, because relation
   *
   * For example for @ManyToMany(type => Category) in Post, target will be Post.
   * If @ManyToMany(type => Category) is in Counters which is embedded into Post, target will be Counters.
   * If @ManyToMany(type => Category) is in abstract class BaseUser which Post extends, target will be BaseUser.
   * Target can be string if its defined in entity schema instead of class.
   */
  public target: TFunction | string;

  /**
   * Target's property name to which relation decorator is applied.
   */
  public propertyName: string;

  /**
   * Gets full path to this column property (including relation name).
   * Full path is relevant when column is used in embeds (one or multiple nested).
   * For example it will return "counters.subcounters.likes".
   * If property is not in embeds then it returns just property name of the column.
   */
  public propertyPath!: string;

  /**
   * Indicates if this is a parent (can be only many-to-one relation) relation in the tree tables.
   */
  public isTreeParent = false;

  /**
   * Indicates if this is a children (can be only one-to-many relation) relation in the tree tables.
   */
  public isTreeChildren = false;

  /**
   * Indicates if this relation's column is a primary key.
   * Can be used only for many-to-one and owner one-to-one relations.
   */
  public isPrimary = false;

  /**
   * Indicates if this relation is lazily loaded.
   */
  public isLazy = false;

  /**
   * Indicates if this relation is eagerly loaded.
   */
  public isEager = false;

  /**
   * Indicates if persistence is enabled for the relation.
   * By default its enabled, but if you want to avoid any changes in the relation to be reflected in the database you can disable it.
   * If its disabled you can only change a relation from inverse side of a relation or using relation query builder functionality.
   * This is useful for performance optimization since its disabling avoid multiple extra queries during entity save.
   */
  public persistenceEnabled = true;

  /**
   * When a parent is saved (with cascading but) without a child row that still exists in database, this will control what shall happen to them.
   * delete will remove these rows from database. nullify will remove the relation key.
   * skip will keep the relation intact. Removal of related item is only possible through its own repo.
   */
  public orphanedRowAction?: 'nullify' | 'delete' | 'soft-delete' | 'disable';

  /**
   * If set to true then related objects are allowed to be inserted to the database.
   */
  public isCascadeInsert = false;

  /**
   * If set to true then related objects are allowed to be updated in the database.
   */
  public isCascadeUpdate = false;

  /**
   * If set to true then related objects are allowed to be remove from the database.
   */
  public isCascadeRemove = false;

  /**
   * If set to true then related objects are allowed to be soft-removed from the database.
   */
  public isCascadeSoftRemove = false;

  /**
   * If set to true then related objects are allowed to be recovered from the database.
   */
  public isCascadeRecover = false;

  /**
   * Indicates if relation column value can be nullable or not.
   */
  public isNullable = true;

  /**
   * What to do with a relation on deletion of the row containing a foreign key.
   */
  public onDelete?: OnDeleteType;

  /**
   * What to do with a relation on update of the row containing a foreign key.
   */
  public onUpdate?: OnUpdateType;

  /**
   * What to do with a relation on update of the row containing a foreign key.
   */
  public deferrable?: DeferrableType;

  /**
   * Indicates whether foreign key constraints will be created for join columns.
   * Can be used only for many-to-one and owner one-to-one relations.
   * Defaults to true.
   */
  public createForeignKeyConstraints = true;

  /**
   * Gets the property's type to which this relation is applied.
   *
   * For example for @ManyToMany(type => Category) in Post, target will be Category.
   */
  public type: TFunction | string;

  /**
   * Indicates if this side is an owner of this relation.
   */
  public isOwning = false;

  /**
   * Checks if this relation's type is "one-to-one".
   */
  public isOneToOne = false;

  /**
   * Checks if this relation is owner side of the "one-to-one" relation.
   * Owner side means this side of relation has a join column in the table.
   */
  public isOneToOneOwner = false;

  /**
   * Checks if this relation has a join column (e.g. is it many-to-one or one-to-one owner side).
   */
  public isWithJoinColumn = false;

  /**
   * Checks if this relation is NOT owner side of the "one-to-one" relation.
   * NOT owner side means this side of relation does not have a join column in the table.
   */
  public isOneToOneNotOwner = false;

  /**
   * Checks if this relation's type is "one-to-many".
   */
  public isOneToMany = false;

  /**
   * Checks if this relation's type is "many-to-one".
   */
  public isManyToOne = false;

  /**
   * Checks if this relation's type is "many-to-many".
   */
  public isManyToMany = false;

  /**
   * Checks if this relation's type is "many-to-many", and is owner side of the relationship.
   * Owner side means this side of relation has a join table.
   */
  public isManyToManyOwner = false;

  /**
   * Checks if this relation's type is "many-to-many", and is NOT owner side of the relationship.
   * Not owner side means this side of relation does not have a join table.
   */
  public isManyToManyNotOwner = false;

  /**
   * Gets the property path of the inverse side of the relation.
   */
  public inverseSidePropertyPath!: string;

  /**
   * Inverse side of the relation set by user.
   *
   * Inverse side set in the relation can be either string - property name of the column on inverse side,
   * either can be a function that accepts a map of properties with the object and returns one of them.
   * Second approach is used to achieve type-safety.
   */
  public givenInverseSidePropertyFactory!: PropertyTypeFactory<ObjectLiteral>;

  /**
   * Gets the relation metadata of the inverse side of this relation.
   */
  public inverseRelation?: RelationMetadata;

  /**
   * Join table name.
   */
  public joinTableName!: string;

  /**
   * Foreign keys created for this relation.
   */
  public foreignKeys: Array<ForeignKeyMetadata> = [];

  /**
   * Join table columns.
   * Join columns can be obtained only from owner side of the relation.
   * From non-owner side of the relation join columns will be empty.
   * If this relation is a many-to-one/one-to-one then it takes join columns from the current entity.
   * If this relation is many-to-many then it takes all owner join columns from the junction entity.
   */
  public joinColumns: Array<ColumnMetadata> = [];

  /**
   * Inverse join table columns.
   * Inverse join columns are supported only for many-to-many relations
   * and can be obtained only from owner side of the relation.
   * From non-owner side of the relation join columns will be undefined.
   */
  public inverseJoinColumns: Array<ColumnMetadata> = [];

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    embeddedMetadata?: EmbeddedMetadata;
    args: RelationMetadataArgs;
  }) {
    this.entityMetadata = options.entityMetadata;
    this.embeddedMetadata = options.embeddedMetadata!;
    const args = options.args;
    this.target = args.target;
    this.propertyName = args.propertyName;
    this.relationType = args.relationType;

    if (args.inverseSideProperty)
      this.givenInverseSidePropertyFactory = args.inverseSideProperty;

    this.isLazy = args.isLazy || false;
    // this.isCascadeInsert = args.options.cascade === true || (args.options.cascade instanceof Array && args.options.cascade.indexOf("insert") !== -1);
    // this.isCascadeUpdate = args.options.cascade === true || (args.options.cascade instanceof Array && args.options.cascade.indexOf("update") !== -1);
    // this.isCascadeRemove = args.options.cascade === true || (args.options.cascade instanceof Array && args.options.cascade.indexOf("remove") !== -1);
    // this.isCascadeSoftRemove = args.options.cascade === true || (args.options.cascade instanceof Array && args.options.cascade.indexOf("soft-remove") !== -1);
    // this.isCascadeRecover = args.options.cascade === true || (args.options.cascade instanceof Array && args.options.cascade.indexOf("recover") !== -1);
    this.isCascadeInsert =
      args.options.cascade === true ||
      (Array.isArray(args.options.cascade) &&
        args.options.cascade.indexOf('insert') !== -1);
    this.isCascadeUpdate =
      args.options.cascade === true ||
      (Array.isArray(args.options.cascade) &&
        args.options.cascade.indexOf('update') !== -1);
    this.isCascadeRemove =
      args.options.cascade === true ||
      (Array.isArray(args.options.cascade) &&
        args.options.cascade.indexOf('remove') !== -1);
    this.isCascadeSoftRemove =
      args.options.cascade === true ||
      (Array.isArray(args.options.cascade) &&
        args.options.cascade.indexOf('soft-remove') !== -1);
    this.isCascadeRecover =
      args.options.cascade === true ||
      (Array.isArray(args.options.cascade) &&
        args.options.cascade.indexOf('recover') !== -1);
    // this.isPrimary = args.options.primary || false;
    this.isNullable =
      args.options.nullable === false || this.isPrimary ? false : true;
    this.onDelete = args.options.onDelete;
    this.onUpdate = args.options.onUpdate;
    this.deferrable = args.options.deferrable;
    this.createForeignKeyConstraints =
      args.options.createForeignKeyConstraints === false ? false : true;
    this.isEager = args.options.eager || false;
    this.persistenceEnabled = args.options.persistence === false ? false : true;
    this.orphanedRowAction = args.options.orphanedRowAction || 'nullify';
    this.isTreeParent = args.isTreeParent || false;
    this.isTreeChildren = args.isTreeChildren || false;

    if (typeof args.type === 'function') {
      // Check if it's a type factory function (callable) or a class constructor
      const typeFactory = args.type as
        | ((type?: unknown) => TFunction)
        | TFunction;
      // If it's a type factory (takes optional parameter), call it; otherwise it's a class constructor
      this.type = (
        typeFactory.length === 0 ? typeFactory() : typeFactory
      ) as TFunction;
    } else if (InstanceChecker.isEntitySchema(args.type)) {
      this.type = (args.type as EntitySchema<unknown>).options.name;
    } else if (
      ObjectUtils.isObject(args.type) &&
      typeof (args.type as Record<string, string>).name === 'string'
    ) {
      this.type = (args.type as Record<string, string>).name as string;
    } else {
      this.type = args.type as string | TFunction;
    }

    this.isOneToOne = this.relationType === 'one-to-one';
    this.isOneToMany = this.relationType === 'one-to-many';
    this.isManyToOne = this.relationType === 'many-to-one';
    this.isManyToMany = this.relationType === 'many-to-many';
    this.isOneToOneNotOwner = this.isOneToOne ? true : false;
    this.isManyToManyNotOwner = this.isManyToMany ? true : false;
  }

  // ---------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------

  /**
   * Creates join column ids map from the given related entity ids array.
   */
  public getRelationIdMap(entity: ObjectLiteral): ObjectLiteral | undefined {
    const joinColumns = this.isOwning
      ? this.joinColumns
      : this.inverseRelation!.joinColumns;
    const referencedColumns = joinColumns.map(
      (joinColumn) => joinColumn.referencedColumn!
    );
    // console.log("entity", entity);
    // console.log("referencedColumns", referencedColumns);
    return EntityMetadata.getValueMap(entity, referencedColumns);
  }

  /**
   * Ensures that given object is an entity id map.
   * If given id is an object then it means its already id map.
   * If given id isn't an object then it means its a value of the id column
   * and it creates a new id map with this value and name of the primary column.
   */
  public ensureRelationIdMap(id: unknown): ObjectLiteral {
    if (ObjectUtils.isObject(id)) return id as ObjectLiteral;

    const joinColumns = this.isOwning
      ? this.joinColumns
      : this.inverseRelation!.joinColumns;
    const referencedColumns = joinColumns.map(
      (joinColumn) => joinColumn.referencedColumn!
    );

    if (referencedColumns.length > 1)
      throw new TypeORMError(
        `Cannot create relation id map for a single value because relation contains multiple referenced columns.`
      );

    return referencedColumns[0]?.createValueMap(id) as ObjectLiteral;
  }

  /**
   * Extracts column value from the given entity.
   * If column is in embedded (or recursive embedded) it extracts its value from there.
   */
  public getEntityValue(
    entity: ObjectLiteral,
    getLazyRelationsPromiseValue = false
  ): ObjectLiteral | undefined {
    if (entity === null || entity === undefined) return undefined;
    // extract column value from embeddeds of entity if column is in embedded
    if (this.embeddedMetadata) {
      // example: post[data][information][counters].id where "data", "information" and "counters" are embeddeds
      // we need to get value of "id" column from the post real entity object

      // first step - we extract all parent properties of the entity relative to this column, e.g. [data, information, counters]
      const propertyNames = [...this.embeddedMetadata.parentPropertyNames];

      // next we need to access post[data][information][counters][this.propertyName] to get column value from the counters
      // this recursive function takes array of generated property names and gets the post[data][information][counters] embed
      const extractEmbeddedColumnValue = (
        propertyNames: Array<string>,
        value: ObjectLiteral
      ): ObjectLiteral | undefined => {
        const propertyName = propertyNames.shift();
        if (propertyName) {
          if (value[propertyName]) {
            return extractEmbeddedColumnValue(
              propertyNames,
              value[propertyName] as ObjectLiteral
            );
          }
          return undefined;
        }
        return value;
      };

      // once we get nested embed object we get its column, e.g. post[data][information][counters][this.propertyName]
      const embeddedObject = extractEmbeddedColumnValue(propertyNames, entity);

      if (this.isLazy && embeddedObject) {
        if (embeddedObject['__' + this.propertyName + '__'] !== undefined)
          return embeddedObject[
            '__' + this.propertyName + '__'
          ] as ObjectLiteral;

        if (getLazyRelationsPromiseValue === true)
          return embeddedObject[this.propertyName] as ObjectLiteral;

        return undefined;
      }
      return embeddedObject
        ? (embeddedObject[
            this.isLazy ? '__' + this.propertyName + '__' : this.propertyName
          ] as ObjectLiteral)
        : undefined;
    } else {
      // no embeds - no problems. Simply return column name by property name of the entity
      if (this.isLazy) {
        if (entity['__' + this.propertyName + '__'] !== undefined)
          return entity['__' + this.propertyName + '__'] as ObjectLiteral;

        if (getLazyRelationsPromiseValue === true)
          return entity[this.propertyName] as ObjectLiteral;

        return undefined;
      }
      return entity[this.propertyName] as ObjectLiteral;
    }
  }

  /**
   * Sets given entity's relation's value.
   * Using of this method helps to set entity relation's value of the lazy and non-lazy relations.
   *
   * If merge is set to true, it merges given value into currently
   */
  public setEntityValue(
    entity: ObjectLiteral,
    value: unknown
  ): ObjectLiteral | void {
    const propertyName = this.isLazy
      ? '__' + this.propertyName + '__'
      : this.propertyName;

    if (this.embeddedMetadata) {
      // first step - we extract all parent properties of the entity relative to this column, e.g. [data, information, counters]
      const extractEmbeddedColumnValue = (
        embeddedMetadatas: Array<EmbeddedMetadata>,
        map: ObjectLiteral
      ): ObjectLiteral => {
        // if (!object[embeddedMetadata.propertyName])
        //     object[embeddedMetadata.propertyName] = embeddedMetadata.create();

        const embeddedMetadata = embeddedMetadatas.shift();
        if (embeddedMetadata) {
          if (!map[embeddedMetadata.propertyName])
            map[embeddedMetadata.propertyName] = embeddedMetadata.create();

          extractEmbeddedColumnValue(
            embeddedMetadatas,
            map[embeddedMetadata.propertyName] as ObjectLiteral
          );
          return map;
        }
        map[propertyName] = value;
        return map;
      };
      return extractEmbeddedColumnValue(
        [...this.embeddedMetadata.embeddedMetadataTree],
        entity
      );
    } else {
      entity[propertyName] = value;
    }
  }

  /**
   * Creates entity id map from the given entity ids array.
   */
  public createValueMap(value: unknown): Record<string, unknown> {
    // extract column value from embeds of entity if column is in embedded
    if (this.embeddedMetadata) {
      // example: post[data][information][counters].id where "data", "information" and "counters" are embeddeds
      // we need to get value of "id" column from the post real entity object and return it in a
      // { data: { information: { counters: { id: ... } } } } format

      // first step - we extract all parent properties of the entity relative to this column, e.g. [data, information, counters]
      const propertyNames = [...this.embeddedMetadata.parentPropertyNames];

      // now need to access post[data][information][counters] to get column value from the counters
      // and on each step we need to create complex literal object, e.g. first { data },
      // then { data: { information } }, then { data: { information: { counters } } },
      // then { data: { information: { counters: [this.propertyName]: entity[data][information][counters][this.propertyName] } } }
      // this recursive function helps doing that
      const extractEmbeddedColumnValue = (
        propertyNames: Array<string>,
        map: ObjectLiteral
      ): ObjectLiteral => {
        const propertyName = propertyNames.shift();
        if (propertyName) {
          map[propertyName] = {};
          extractEmbeddedColumnValue(
            propertyNames,
            map[propertyName] as ObjectLiteral
          );
          return map;
        }
        map[this.propertyName] = value;
        return map;
      };
      return extractEmbeddedColumnValue(propertyNames, {});
    } else {
      // no embeds - no problems. Simply return column property name and its value of the entity
      return { [this.propertyName]: value };
    }
  }

  // ---------------------------------------------------------------------
  // Builder Methods
  // ---------------------------------------------------------------------

  /**
   * Builds some depend relation metadata properties.
   * This builder method should be used only after embedded metadata tree was build.
   */
  public build(): void {
    this.propertyPath = this.buildPropertyPath();
  }

  /**
   * Registers given foreign keys in the relation.
   * This builder method should be used to register foreign key in the relation.
   */
  public registerForeignKeys(...foreignKeys: Array<ForeignKeyMetadata>): void {
    this.foreignKeys.push(...foreignKeys);
  }

  /**
   * Registers given join columns in the relation.
   * This builder method should be used to register join column in the relation.
   */
  public registerJoinColumns(
    joinColumns: Array<ColumnMetadata> = [],
    inverseJoinColumns: Array<ColumnMetadata> = []
  ): void {
    this.joinColumns = joinColumns;
    this.inverseJoinColumns = inverseJoinColumns;
    this.isOwning =
      this.isManyToOne ||
      ((this.isManyToMany || this.isOneToOne) && this.joinColumns.length > 0);
    this.isOneToOneOwner = this.isOneToOne && this.isOwning;
    this.isOneToOneNotOwner = this.isOneToOne && !this.isOwning;
    this.isManyToManyOwner = this.isManyToMany && this.isOwning;
    this.isManyToManyNotOwner = this.isManyToMany && !this.isOwning;
    this.isWithJoinColumn = this.isManyToOne || this.isOneToOneOwner;
  }

  /**
   * Registers a given junction entity metadata.
   * This builder method can be called after junction entity metadata for the many-to-many relation was created.
   */
  public registerJunctionEntityMetadata(
    junctionEntityMetadata: EntityMetadata
  ): void {
    this.junctionEntityMetadata = junctionEntityMetadata;
    this.joinTableName = junctionEntityMetadata.tableName;
    if (this.inverseRelation) {
      this.inverseRelation.junctionEntityMetadata = junctionEntityMetadata;
      this.joinTableName = junctionEntityMetadata.tableName;
    }
  }

  /**
   * Builds inverse side property path based on given inverse side property factory.
   * This builder method should be used only after properties map of the inverse entity metadata was build.
   */
  public buildInverseSidePropertyPath(): string {
    if (this.givenInverseSidePropertyFactory) {
      const ownerEntityPropertiesMap = this.inverseEntityMetadata.propertiesMap;
      if (typeof this.givenInverseSidePropertyFactory === 'function')
        return this.givenInverseSidePropertyFactory(
          ownerEntityPropertiesMap
        ) as string;

      if (typeof this.givenInverseSidePropertyFactory === 'string')
        return this.givenInverseSidePropertyFactory;
    } else if (this.isTreeParent && this.entityMetadata.treeChildrenRelation) {
      return this.entityMetadata.treeChildrenRelation.propertyName;
    } else if (this.isTreeChildren && this.entityMetadata.treeParentRelation) {
      return this.entityMetadata.treeParentRelation.propertyName;
    }

    return '';
  }

  /**
   * Builds relation's property path based on its embedded tree.
   */
  public buildPropertyPath(): string {
    if (
      !this.embeddedMetadata ||
      !this.embeddedMetadata.parentPropertyNames.length
    )
      return this.propertyName;

    return (
      this.embeddedMetadata.parentPropertyNames.join('.') +
      '.' +
      this.propertyName
    );
  }
}
