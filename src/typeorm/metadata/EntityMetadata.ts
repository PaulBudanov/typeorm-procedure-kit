import type { TFunction } from '../../types/utility.types.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { DataSource } from '../data-source/DataSource.js';
import type { Driver } from '../driver/Driver.js';
import { CannotCreateEntityIdMapError } from '../error/CannotCreateEntityIdMapError.js';
// import { OrderByCondition } from '../find-options/OrderByCondition.js';
import { EntityPropertyNotFoundError } from '../error/EntityPropertyNotFoundError.js';
import type { OrderByCondition } from '../find-options/OrderByCondition.js';
import type { TableMetadataArgs } from '../metadata-args/TableMetadataArgs.js';
import type { TreeMetadataArgs } from '../metadata-args/TreeMetadataArgs.js';
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
import { ObjectUtils } from '../util/ObjectUtils.js';
import { OrmUtils } from '../util/OrmUtils.js';
import { shorten } from '../util/StringUtils.js';

import type { CheckMetadata } from './CheckMetadata.js';
import type { ColumnMetadata } from './ColumnMetadata.js';
import type { EmbeddedMetadata } from './EmbeddedMetadata.js';
import type { EntityListenerMetadata } from './EntityListenerMetadata.js';
import type { ExclusionMetadata } from './ExclusionMetadata.js';
import type { ForeignKeyMetadata } from './ForeignKeyMetadata.js';
import type { IndexMetadata } from './IndexMetadata.js';
import type { RelationCountMetadata } from './RelationCountMetadata.js';
import type { RelationIdMetadata } from './RelationIdMetadata.js';
import type { RelationMetadata } from './RelationMetadata.js';
import type { ClosureTreeOptions } from './types/ClosureTreeOptions.js';
import type { TableType } from './types/TableTypes.js';
import type { TreeType } from './types/TreeTypes.js';
import type { UniqueMetadata } from './UniqueMetadata.js';

/**
 * Contains all entity metadata.
 */
export class EntityMetadata {
  public readonly '@instanceof' = Symbol.for('EntityMetadata');

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  /**
   * Connection where this entity metadata is created.
   */
  public connection: DataSource;

  /**
   * Driver used by this entity metadata.
   */
  public get driver(): Driver {
    return this.connection.driver;
  }

  /**
   * Metadata arguments used to build this entity metadata.
   */
  public tableMetadataArgs: TableMetadataArgs;

  /**
   * If entity's table is a closure-typed table, then this entity will have a closure junction table metadata.
   */
  public closureJunctionTable!: EntityMetadata;

  /**
   * If this is entity metadata for a junction closure table then its owner closure table metadata will be set here.
   */
  public parentClosureEntityMetadata: EntityMetadata;

  /**
   * Parent's entity metadata. Used in inheritance patterns.
   */
  public parentEntityMetadata!: EntityMetadata;

  /**
   * Children entity metadatas. Used in inheritance patterns.
   */
  public childEntityMetadatas: Array<EntityMetadata> = [];

  /**
   * All "inheritance tree" from a target entity.
   * For example for target Post < ContentModel < Unit it will be an array of [Post, ContentModel, Unit].
   * It also contains child entities for single table inheritance.
   */
  public inheritanceTree: Array<TFunction> = [];

  /**
   * Table type. Tables can be closure, junction, etc.
   */
  public tableType: TableType = 'regular';

  /**
   * Target class to which this entity metadata is bind.
   * Note, that when using table inheritance patterns target can be different rather then table's target.
   * For virtual tables which lack of real entity (like junction tables) target is equal to their table name.
   */
  public target: TFunction | string;

  /**
   * Gets the name of the target.
   */
  public targetName!: string;

  /**
   * Entity's name.
   * Equal to entity target class's name if target is set to table.
   * If target class is not then then it equals to table name.
   */
  public name!: string;

  /**
   * View's expression.
   * Used in views
   */
  public expression?:
    | string
    | ((connection: DataSource) => SelectQueryBuilder<ObjectLiteral>);

  /**
   * View's dependencies.
   * Used in views
   */
  public dependsOn?: Set<TFunction | string>;

  /**
   * Enables Sqlite "WITHOUT ROWID" modifier for the "CREATE TABLE" statement
   */
  public withoutRowid?: boolean = false;

  /**
   * Original user-given table name (taken from schema or @Entity(tableName) decorator).
   * If user haven't specified a table name this property will be undefined.
   */
  public givenTableName?: string;

  /**
   * Entity table name in the database.
   * This is final table name of the entity.
   * This name already passed naming strategy, and generated based on
   * multiple criteria, including user table name and global table prefix.
   */
  public tableName!: string;

  /**
   * Entity table path. Contains database name, schema name and table name.
   * E.g. myDB.mySchema.myTable
   */
  public tablePath!: string;

  /**
   * Gets the table name without global table prefix.
   * When querying table you need a table name with prefix, but in some scenarios,
   * for example when you want to name a junction table that contains names of two other tables,
   * you may want a table name without prefix.
   */
  public tableNameWithoutPrefix!: string;

  /**
   * Indicates if schema will be synchronized for this entity or not.
   */
  public synchronize = true;

  /**
   * Table's database engine type (like "InnoDB", "MyISAM", etc).
   */
  public engine?: string;

  /**
   * Database name.
   */
  public database?: string;

  /**
   * Schema name. Used in Postgres and Sql Server.
   */
  public schema?: string;

  /**
   * Specifies a default order by used for queries from this table when no explicit order by is specified.
   */
  public orderBy?: OrderByCondition;

  /**
   * If this entity metadata's table using one of the inheritance patterns,
   * then this will contain what pattern it uses.
   */
  public inheritancePattern?: 'STI'; /*|"CTI"*/

  /**
   * Checks if there any non-nullable column exist in this entity.
   */
  public hasNonNullableRelations = false;

  /**
   * Indicates if this entity metadata of a junction table, or not.
   * Junction table is a table created by many-to-many relationship.
   *
   * Its also possible to understand if entity is junction via tableType.
   */
  public isJunction = false;

  /**
   * Indicates if the entity should be instantiated using the constructor
   * or via allocating a new object via `Object.create()`.
   */
  public isAlwaysUsingConstructor = true;

  /**
   * Indicates if this entity is a tree, what type of tree it is.
   */
  public treeType?: TreeType;

  /**
   * Indicates if this entity is a tree, what options of tree it has.
   */
  public treeOptions?: ClosureTreeOptions;

  /**
   * Checks if this table is a junction table of the closure table.
   * This type is for tables that contain junction metadata of the closure tables.
   */
  public isClosureJunction = false;

  /**
   * Checks if entity's table has multiple primary columns.
   */
  public hasMultiplePrimaryKeys = false;

  /**
   * Indicates if this entity metadata has uuid generated columns.
   */
  public hasUUIDGeneratedColumns = false;

  /**
   * If this entity metadata is a child table of some table, it should have a discriminator value.
   * Used to store a value in a discriminator column.
   */
  public discriminatorValue?: string;

  /**
   * Entity's column metadatas defined by user.
   */
  public ownColumns: Array<ColumnMetadata> = [];

  /**
   * Columns of the entity, including columns that are coming from the embeddeds of this entity.
   */
  public columns: Array<ColumnMetadata> = [];

  /**
   * Ancestor columns used only in closure junction tables.
   */
  public ancestorColumns: Array<ColumnMetadata> = [];

  /**
   * Descendant columns used only in closure junction tables.
   */
  public descendantColumns: Array<ColumnMetadata> = [];

  /**
   * All columns except for virtual columns.
   */
  public nonVirtualColumns: Array<ColumnMetadata> = [];

  /**
   * In the case if this entity metadata is junction table's entity metadata,
   * this will contain all referenced columns of owner entity.
   */
  public ownerColumns: Array<ColumnMetadata> = [];

  /**
   * In the case if this entity metadata is junction table's entity metadata,
   * this will contain all referenced columns of inverse entity.
   */
  public inverseColumns: Array<ColumnMetadata> = [];

  /**
   * Gets the column with generated flag.
   */
  public generatedColumns: Array<ColumnMetadata> = [];

  /**
   * Gets the object id column used with mongodb database.
   */
  public objectIdColumn?: ColumnMetadata;

  /**
   * Gets entity column which contains a create date value.
   */
  public createDateColumn?: ColumnMetadata;

  /**
   * Gets entity column which contains an update date value.
   */
  public updateDateColumn?: ColumnMetadata;

  /**
   * Gets entity column which contains a delete date value.
   */
  public deleteDateColumn?: ColumnMetadata;

  /**
   * Gets entity column which contains an entity version.
   */
  public versionColumn?: ColumnMetadata;

  /**
   * Gets the discriminator column used to store entity identificator in single-table inheritance tables.
   */
  public discriminatorColumn?: ColumnMetadata;

  /**
   * Special column that stores tree level in tree entities.
   */
  public treeLevelColumn?: ColumnMetadata;

  /**
   * Nested set's left value column.
   * Used only in tree entities with nested set pattern applied.
   */
  public nestedSetLeftColumn?: ColumnMetadata;

  /**
   * Nested set's right value column.
   * Used only in tree entities with nested set pattern applied.
   */
  public nestedSetRightColumn?: ColumnMetadata;

  /**
   * Materialized path column.
   * Used only in tree entities with materialized path pattern applied.
   */
  public materializedPathColumn?: ColumnMetadata;

  /**
   * Gets the primary columns.
   */
  public primaryColumns: Array<ColumnMetadata> = [];

  /**
   * Entity's relation metadatas.
   */
  public ownRelations: Array<RelationMetadata> = [];

  /**
   * Relations of the entity, including relations that are coming from the embeddeds of this entity.
   */
  public relations: Array<RelationMetadata> = [];

  /**
   * List of eager relations this metadata has.
   */
  public eagerRelations: Array<RelationMetadata> = [];

  /**
   * List of eager relations this metadata has.
   */
  public lazyRelations: Array<RelationMetadata> = [];

  /**
   * Gets only one-to-one relations of the entity.
   */
  public oneToOneRelations: Array<RelationMetadata> = [];

  /**
   * Gets only owner one-to-one relations of the entity.
   */
  public ownerOneToOneRelations: Array<RelationMetadata> = [];

  /**
   * Gets only one-to-many relations of the entity.
   */
  public oneToManyRelations: Array<RelationMetadata> = [];

  /**
   * Gets only many-to-one relations of the entity.
   */
  public manyToOneRelations: Array<RelationMetadata> = [];

  /**
   * Gets only many-to-many relations of the entity.
   */
  public manyToManyRelations: Array<RelationMetadata> = [];

  /**
   * Gets only owner many-to-many relations of the entity.
   */
  public ownerManyToManyRelations: Array<RelationMetadata> = [];

  /**
   * Gets only owner one-to-one and many-to-one relations.
   */
  public relationsWithJoinColumns: Array<RelationMetadata> = [];

  /**
   * Tree parent relation. Used only in tree-tables.
   */
  public treeParentRelation?: RelationMetadata;

  /**
   * Tree children relation. Used only in tree-tables.
   */
  public treeChildrenRelation?: RelationMetadata;

  /**
   * Entity's relation id metadatas.
   */
  public relationIds: Array<RelationIdMetadata> = [];

  /**
   * Entity's relation id metadatas.
   */
  public relationCounts: Array<RelationCountMetadata> = [];

  /**
   * Entity's foreign key metadatas.
   */
  public foreignKeys: Array<ForeignKeyMetadata> = [];

  /**
   * Entity's embedded metadatas.
   */
  public embeddeds: Array<EmbeddedMetadata> = [];

  /**
   * All embeddeds - embeddeds from this entity metadata and from all child embeddeds, etc.
   */
  public allEmbeddeds: Array<EmbeddedMetadata> = [];

  /**
   * Entity's own indices.
   */
  public ownIndices: Array<IndexMetadata> = [];

  /**
   * Entity's index metadatas.
   */
  public indices: Array<IndexMetadata> = [];

  /**
   * Entity's unique metadatas.
   */
  public uniques: Array<UniqueMetadata> = [];

  /**
   * Entity's own uniques.
   */
  public ownUniques: Array<UniqueMetadata> = [];

  /**
   * Entity's check metadatas.
   */
  public checks: Array<CheckMetadata> = [];

  /**
   * Entity's exclusion metadatas.
   */
  public exclusions: Array<ExclusionMetadata> = [];

  /**
   * Entity's own listener metadatas.
   */
  public ownListeners: Array<EntityListenerMetadata> = [];

  /**
   * Entity listener metadatas.
   */
  public listeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "AFTER LOAD" type.
   */
  public afterLoadListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "BEFORE INSERT" type.
   */
  public beforeInsertListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "AFTER INSERT" type.
   */
  public afterInsertListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "BEFORE UPDATE" type.
   */
  public beforeUpdateListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "AFTER UPDATE" type.
   */
  public afterUpdateListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "BEFORE REMOVE" type.
   */
  public beforeRemoveListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "BEFORE SOFT REMOVE" type.
   */
  public beforeSoftRemoveListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "BEFORE RECOVER" type.
   */
  public beforeRecoverListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "AFTER REMOVE" type.
   */
  public afterRemoveListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "AFTER SOFT REMOVE" type.
   */
  public afterSoftRemoveListeners: Array<EntityListenerMetadata> = [];

  /**
   * Listener metadatas with "AFTER RECOVER" type.
   */
  public afterRecoverListeners: Array<EntityListenerMetadata> = [];

  /**
   * Map of columns and relations of the entity.
   *
   * example: Post{ id: number, name: string, counterEmbed: { count: number }, category: Category }.
   * This method will create following object:
   * { id: "id", counterEmbed: { count: "counterEmbed.count" }, category: "category" }
   */
  public propertiesMap!: ObjectLiteral;

  /**
   * Table comment. Not supported by all database types.
   */
  public comment?: string;

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    connection: DataSource;
    inheritanceTree?: Array<TFunction>;
    inheritancePattern?: 'STI'; /*|"CTI"*/
    tableTree?: TreeMetadataArgs;
    parentClosureEntityMetadata?: EntityMetadata;
    args: TableMetadataArgs;
  }) {
    this.connection = options.connection;
    this.inheritanceTree = options.inheritanceTree || [];
    this.inheritancePattern = options.inheritancePattern;
    this.treeType = options.tableTree ? options.tableTree.type : undefined;
    this.treeOptions = options.tableTree
      ? options.tableTree.options
      : undefined;
    this.parentClosureEntityMetadata = options.parentClosureEntityMetadata!;
    this.tableMetadataArgs = options.args;
    this.target = this.tableMetadataArgs.target;
    this.tableType = this.tableMetadataArgs.type;
    this.expression = this.tableMetadataArgs.expression;
    this.withoutRowid = this.tableMetadataArgs.withoutRowid;
    this.dependsOn = this.tableMetadataArgs.dependsOn;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new entity.
   */
  public create(
    queryRunner?: QueryRunner,
    options?: { fromDeserializer?: boolean; pojo?: boolean }
  ): ObjectLiteral {
    const pojo = options && options.pojo === true ? true : false;
    // if target is set to a function (e.g. class) that can be created then create it
    let ret: unknown;
    if (typeof this.target === 'function' && !pojo) {
      if (!options?.fromDeserializer || this.isAlwaysUsingConstructor) {
        // ret = new (this.target as unknown as typeof this)();
        //TODO: FIX TYPES
        ret = new (this.target as unknown as new () => unknown)();
      } else {
        ret = Object.create(this.target.prototype as object);
      }
    } else {
      // otherwise simply return a new empty object
      ret = {};
    }

    this.lazyRelations.forEach((relation) =>
      this.connection.relationLoader.enableLazyLoad(
        relation,
        ret as ObjectLiteral,
        queryRunner
      )
    );
    return ret as ObjectLiteral;
  }

  /**
   * Checks if given entity has an id.
   */
  public hasId(entity: ObjectLiteral): boolean {
    if (!entity) return false;

    return this.primaryColumns.every((primaryColumn) => {
      const value = primaryColumn.getEntityValue(entity);
      return value !== null && value !== undefined && value !== '';
    });
  }

  /**
   * Checks if given entity / object contains ALL primary keys entity must have.
   * Returns true if it contains all of them, false if at least one of them is not defined.
   */
  public hasAllPrimaryKeys(entity: ObjectLiteral): boolean {
    return this.primaryColumns.every((primaryColumn) => {
      const value = primaryColumn.getEntityValue(entity);
      return value !== null && value !== undefined;
    });
  }

  /**
   * Ensures that given object is an entity id map.
   * If given id is an object then it means its already id map.
   * If given id isn't an object then it means its a value of the id column
   * and it creates a new id map with this value and name of the primary column.
   */
  public ensureEntityIdMap(id: unknown): ObjectLiteral {
    if (ObjectUtils.isObject(id)) return id as ObjectLiteral;

    if (this.hasMultiplePrimaryKeys)
      throw new CannotCreateEntityIdMapError(this, id);

    return this.primaryColumns[0]?.createValueMap(id) as ObjectLiteral;
  }

  /**
   * Gets primary keys of the entity and returns them in a literal object.
   * For example, for Post{ id: 1, title: "hello" } where id is primary it will return { id: 1 }
   * For multiple primary keys it returns multiple keys in object.
   * For primary keys inside embeds it returns complex object literal with keys in them.
   */
  public getEntityIdMap(
    entity: ObjectLiteral | undefined
  ): ObjectLiteral | undefined {
    if (!entity) return undefined;

    return EntityMetadata.getValueMap(entity, this.primaryColumns);
  }

  /**
   * Creates a "mixed id map".
   * If entity has multiple primary keys (ids) then it will return just regular id map, like what getEntityIdMap returns.
   * But if entity has a single primary key then it will return just value of the id column of the entity, just value.
   * This is called mixed id map.
   */
  public getEntityIdMixedMap(
    entity: ObjectLiteral | undefined
  ): ObjectLiteral | undefined | string {
    if (!entity) return entity;

    const idMap = this.getEntityIdMap(entity);
    if (this.hasMultiplePrimaryKeys) {
      return idMap;
    } else if (idMap) {
      return this.primaryColumns[0]?.getEntityValue(idMap); // todo: what about parent primary column?
    }

    return idMap;
  }

  /**
   * Compares two different entities by their ids.
   * Returns true if they match, false otherwise.
   */
  public compareEntities(
    firstEntity: ObjectLiteral,
    secondEntity: ObjectLiteral
  ): boolean {
    const firstEntityIdMap = this.getEntityIdMap(firstEntity);
    if (!firstEntityIdMap) return false;

    const secondEntityIdMap = this.getEntityIdMap(secondEntity);
    if (!secondEntityIdMap) return false;

    return OrmUtils.compareIds(firstEntityIdMap, secondEntityIdMap);
  }

  /**
   * Finds column with a given property name.
   */
  public findColumnWithPropertyName(
    propertyName: string
  ): ColumnMetadata | undefined {
    return this.columns.find((column) => column.propertyName === propertyName);
  }

  /**
   * Finds column with a given database name.
   */
  public findColumnWithDatabaseName(
    databaseName: string
  ): ColumnMetadata | undefined {
    return this.columns.find((column) => column.databaseName === databaseName);
  }

  /**
   * Checks if there is a column or relationship with a given property path.
   */
  public hasColumnWithPropertyPath(propertyPath: string): boolean {
    const hasColumn = this.columns.some(
      (column) => column.propertyPath === propertyPath
    );
    return hasColumn || this.hasRelationWithPropertyPath(propertyPath);
  }

  /**
   * Finds column with a given property path.
   */
  public findColumnWithPropertyPath(
    propertyPath: string
  ): ColumnMetadata | undefined {
    const column = this.columns.find(
      (column) => column.propertyPath === propertyPath
    );
    if (column) return column;

    // in the case if column with property path was not found, try to find a relation with such property path
    // if we find relation and it has a single join column then its the column user was seeking
    const relation = this.relations.find(
      (relation) => relation.propertyPath === propertyPath
    );
    if (relation && relation.joinColumns.length === 1)
      return relation.joinColumns[0];

    return undefined;
  }

  /**
   * Finds column with a given property path.
   * Does not search in relation unlike findColumnWithPropertyPath.
   */
  public findColumnWithPropertyPathStrict(
    propertyPath: string
  ): ColumnMetadata | undefined {
    return this.columns.find((column) => column.propertyPath === propertyPath);
  }

  /**
   * Finds columns with a given property path.
   * Property path can match a relation, and relations can contain multiple columns.
   */
  public findColumnsWithPropertyPath(
    propertyPath: string
  ): Array<ColumnMetadata> {
    const column = this.columns.find(
      (column) => column.propertyPath === propertyPath
    );
    if (column) return [column];

    // in the case if column with property path was not found, try to find a relation with such property path
    // if we find relation and it has a single join column then its the column user was seeking
    const relation = this.findRelationWithPropertyPath(propertyPath);
    if (relation && relation.joinColumns) return relation.joinColumns;

    return [];
  }

  /**
   * Checks if there is a relation with the given property path.
   */
  public hasRelationWithPropertyPath(propertyPath: string): boolean {
    return this.relations.some(
      (relation) => relation.propertyPath === propertyPath
    );
  }

  /**
   * Finds relation with the given property path.
   */
  public findRelationWithPropertyPath(
    propertyPath: string
  ): RelationMetadata | undefined {
    return this.relations.find(
      (relation) => relation.propertyPath === propertyPath
    );
  }

  /**
   * Checks if there is an embedded with a given property path.
   */
  public hasEmbeddedWithPropertyPath(propertyPath: string): boolean {
    return this.allEmbeddeds.some(
      (embedded) => embedded.propertyPath === propertyPath
    );
  }

  /**
   * Finds embedded with a given property path.
   */
  public findEmbeddedWithPropertyPath(
    propertyPath: string
  ): EmbeddedMetadata | undefined {
    return this.allEmbeddeds.find(
      (embedded) => embedded.propertyPath === propertyPath
    );
  }

  /**
   * Returns an array of databaseNames mapped from provided propertyPaths
   */
  public mapPropertyPathsToColumns(
    propertyPaths: Array<string>
  ): Array<ColumnMetadata> {
    return propertyPaths.map((propertyPath) => {
      const column = this.findColumnWithPropertyPath(propertyPath);
      if (column == null) {
        throw new EntityPropertyNotFoundError(propertyPath, this);
      }
      return column;
    });
  }

  /**
   * Iterates through entity and finds and extracts all values from relations in the entity.
   * If relation value is an array its being flattened.
   */
  public extractRelationValuesFromEntity(
    entity: ObjectLiteral,
    relations: Array<RelationMetadata>
  ): Array<[RelationMetadata, unknown, EntityMetadata]> {
    const relationsAndValues: Array<
      [RelationMetadata, unknown, EntityMetadata]
    > = [];
    relations.forEach((relation) => {
      const value = relation.getEntityValue(entity);
      if (Array.isArray(value)) {
        value.forEach((subValue) =>
          relationsAndValues.push([
            relation,
            subValue,
            EntityMetadata.getInverseEntityMetadata(
              subValue as ObjectLiteral,
              relation
            ),
          ])
        );
      } else if (value) {
        relationsAndValues.push([
          relation,
          value,
          EntityMetadata.getInverseEntityMetadata(value, relation),
        ]);
      }
    });
    return relationsAndValues;
  }

  /**
   * In the case of SingleTableInheritance, find the correct metadata
   * for a given value.
   *
   * @param value The value to find the metadata for.
   * @returns The found metadata for the entity or the base metadata if no matching metadata
   *          was found in the whole inheritance tree.
   */
  public findInheritanceMetadata(value: ObjectLiteral): EntityMetadata {
    // Check for single table inheritance and find the correct metadata in that case.
    // Goal is to use the correct discriminator as we could have a repository
    // for an (abstract) base class and thus the target would not match.

    if (
      this.inheritancePattern === 'STI' &&
      this.childEntityMetadatas.length > 0
    ) {
      // There could be a column on the base class that can manually be set to override the type.
      let manuallySetDiscriminatorValue: unknown;
      if (this.discriminatorColumn) {
        manuallySetDiscriminatorValue =
          value[this.discriminatorColumn.propertyName];
      }
      return (
        this.childEntityMetadatas.find(
          (meta) =>
            manuallySetDiscriminatorValue === meta.discriminatorValue ||
            value.constructor === meta.target
        ) || this
      );
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // Private Static Methods
  // -------------------------------------------------------------------------

  private static getInverseEntityMetadata(
    value: ObjectLiteral,
    relation: RelationMetadata
  ): EntityMetadata {
    return relation.inverseEntityMetadata.findInheritanceMetadata(value);
  }

  // -------------------------------------------------------------------------
  // Public Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a property paths for a given entity.
   *
   * @deprecated
   */
  public static createPropertyPath(
    metadata: EntityMetadata,
    entity: ObjectLiteral,
    prefix = ''
  ): Array<string> {
    const paths: Array<string> = [];
    Object.keys(entity).forEach((key) => {
      // check for function is needed in the cases when createPropertyPath used on values contain a function as a value
      // example: .update().set({ name: () => `SUBSTR('', 1, 2)` })
      const parentPath = prefix ? prefix + '.' + key : key;
      if (metadata.hasEmbeddedWithPropertyPath(parentPath)) {
        const subPaths = this.createPropertyPath(
          metadata,
          entity[key] as ObjectLiteral,
          parentPath
        );
        paths.push(...subPaths);
      } else {
        const path = prefix ? prefix + '.' + key : key;
        paths.push(path);
      }
    });
    return paths;
  }

  /**
   * Finds difference between two entity id maps.
   * Returns items that exist in the first array and absent in the second array.
   */
  public static difference(
    firstIdMaps: Array<ObjectLiteral>,
    secondIdMaps: Array<ObjectLiteral>
  ): Array<ObjectLiteral> {
    return firstIdMaps.filter((firstIdMap) => {
      return !secondIdMaps.find((secondIdMap) =>
        OrmUtils.compareIds(firstIdMap, secondIdMap)
      );
    });
  }

  /**
   * Creates value map from the given values and columns.
   * Examples of usages are primary columns map and join columns map.
   */
  public static getValueMap(
    entity: ObjectLiteral,
    columns: Array<ColumnMetadata>
  ): ObjectLiteral | undefined {
    return columns.reduce(
      (map, column) => {
        const value = column.getEntityValueMap(entity);

        // make sure that none of the values of the columns are not missing
        if (map === undefined || value === null || value === undefined)
          return undefined;

        // Skip array values as they are not supported in mergeDeep
        if (Array.isArray(value)) return map;

        return OrmUtils.mergeDeep(map, value);
      },
      {} as ObjectLiteral | undefined
    );
  }

  // ---------------------------------------------------------------------
  // Public Builder Methods
  // ---------------------------------------------------------------------

  public build(): void {
    const namingStrategy = this.connection.namingStrategy;
    const entitySkipConstructor = this.connection.options.entitySkipConstructor;
    this.engine = this.tableMetadataArgs.engine;
    this.database =
      this.tableMetadataArgs.type === 'entity-child' &&
      this.parentEntityMetadata
        ? this.parentEntityMetadata.database
        : this.tableMetadataArgs.database;
    if (this.tableMetadataArgs.schema) {
      this.schema = this.tableMetadataArgs.schema;
    } else if (
      this.tableMetadataArgs.type === 'entity-child' &&
      this.parentEntityMetadata
    ) {
      this.schema = this.parentEntityMetadata.schema;
    } else if (this.connection.options.schema) {
      this.schema = this.connection.options.schema;
    }
    this.givenTableName =
      this.tableMetadataArgs.type === 'entity-child' &&
      this.parentEntityMetadata
        ? this.parentEntityMetadata.givenTableName
        : this.tableMetadataArgs.name;
    this.synchronize =
      this.tableMetadataArgs.synchronize === false ? false : true;
    this.targetName =
      typeof this.tableMetadataArgs.target === 'function'
        ? this.tableMetadataArgs.target.name
        : this.tableMetadataArgs.target;
    if (this.tableMetadataArgs.type === 'closure-junction') {
      this.tableNameWithoutPrefix = namingStrategy.closureJunctionTableName(
        this.givenTableName!
      );
    } else if (
      this.tableMetadataArgs.type === 'entity-child' &&
      this.parentEntityMetadata
    ) {
      this.tableNameWithoutPrefix = namingStrategy.tableName(
        this.parentEntityMetadata.targetName,
        this.parentEntityMetadata.givenTableName
      );
    } else {
      this.tableNameWithoutPrefix = namingStrategy.tableName(
        this.targetName,
        this.givenTableName
      );

      if (
        this.tableMetadataArgs.type === 'junction' &&
        this.driver.maxAliasLength &&
        this.driver.maxAliasLength > 0 &&
        this.tableNameWithoutPrefix.length > this.driver.maxAliasLength
      ) {
        // note: we are not using DriverUtils.buildAlias here because we would like to avoid
        // hashed table names. However, current algorithm also isn't perfect, but we cannot
        // change it, since it's a big breaking change. Planned to 0.4.0
        this.tableNameWithoutPrefix = shorten(this.tableNameWithoutPrefix, {
          separator: '_',
          segmentLength: 3,
        });
      }
    }
    this.tableName = this.tableNameWithoutPrefix;
    this.target = this.target ? this.target : this.tableName;
    this.name = this.targetName ? this.targetName : this.tableName;
    this.expression = this.tableMetadataArgs.expression;
    this.withoutRowid =
      this.tableMetadataArgs.withoutRowid === true ? true : false;
    this.tablePath = this.driver.buildTableName(
      this.tableName,
      this.schema,
      this.database
    );
    this.orderBy =
      typeof this.tableMetadataArgs.orderBy === 'function'
        ? this.tableMetadataArgs.orderBy(this.propertiesMap)
        : this.tableMetadataArgs.orderBy; // todo: is propertiesMap available here? Looks like its not
    if (entitySkipConstructor !== undefined) {
      this.isAlwaysUsingConstructor = !entitySkipConstructor;
    }
    this.isJunction =
      this.tableMetadataArgs.type === 'closure-junction' ||
      this.tableMetadataArgs.type === 'junction';
    this.isClosureJunction = this.tableMetadataArgs.type === 'closure-junction';

    this.comment = this.tableMetadataArgs.comment;
  }

  /**
   * Registers a new column in the entity and recomputes all depend properties.
   */
  public registerColumn(column: ColumnMetadata): void {
    if (this.ownColumns.indexOf(column) !== -1) return;

    this.ownColumns.push(column);
    this.columns = this.embeddeds.reduce(
      (columns, embedded) => columns.concat(embedded.columnsFromTree),
      this.ownColumns
    );
    this.primaryColumns = this.columns.filter((column) => column.isPrimary);
    this.hasMultiplePrimaryKeys = this.primaryColumns.length > 1;
    this.hasUUIDGeneratedColumns =
      this.columns.filter(
        (column) => column.isGenerated || column.generationStrategy === 'uuid'
      ).length > 0;
    this.propertiesMap = this.createPropertiesMap();
    if (this.childEntityMetadatas)
      this.childEntityMetadatas.forEach((entityMetadata) =>
        entityMetadata.registerColumn(column)
      );
  }

  /**
   * Creates a special object - all columns and relations of the object (plus columns and relations from embeds)
   * in a special format - { propertyName: propertyName }.
   *
   * example: Post{ id: number, name: string, counterEmbed: { count: number }, category: Category }.
   * This method will create following object:
   * { id: "id", counterEmbed: { count: "counterEmbed.count" }, category: "category" }
   */
  public createPropertiesMap(): ObjectLiteral {
    const map: ObjectLiteral = {};
    this.columns.forEach((column) =>
      OrmUtils.mergeDeep(map, column.createValueMap(column.propertyPath))
    );
    this.relations.forEach((relation) =>
      OrmUtils.mergeDeep(map, relation.createValueMap(relation.propertyPath))
    );
    return map;
  }

  /**
   * Checks if entity has any column which rely on returning data,
   * e.g. columns with auto generated value, DEFAULT values considered as dependant of returning data.
   * For example, if we need to have RETURNING after INSERT (or we need returned id for DBs not supporting RETURNING),
   * it means we cannot execute bulk inserts in some cases.
   */
  public getInsertionReturningColumns(): Array<ColumnMetadata> {
    return this.columns.filter((column) => {
      return (
        column.default !== undefined ||
        column.asExpression !== undefined ||
        column.isGenerated ||
        column.isCreateDate ||
        column.isUpdateDate ||
        column.isDeleteDate ||
        column.isVersion
      );
    });
  }
}
