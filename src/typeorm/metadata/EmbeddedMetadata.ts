import type { TFunction } from '../../types/utility.types.js';
import { DataSource } from '../data-source/DataSource.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { EmbeddedMetadataArgs } from '../metadata-args/EmbeddedMetadataArgs.js';

import { ColumnMetadata } from './ColumnMetadata.js';
import { EntityListenerMetadata } from './EntityListenerMetadata.js';
import { EntityMetadata } from './EntityMetadata.js';
import { IndexMetadata } from './IndexMetadata.js';
import { RelationCountMetadata } from './RelationCountMetadata.js';
import { RelationIdMetadata } from './RelationIdMetadata.js';
import { RelationMetadata } from './RelationMetadata.js';
import { UniqueMetadata } from './UniqueMetadata.js';

/**
 * Contains all information about entity's embedded property.
 */
export class EmbeddedMetadata {
  // ---------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------

  /**
   * Entity metadata where this embedded is.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Parent embedded in the case if this embedded inside other embedded.
   */
  public parentEmbeddedMetadata?: EmbeddedMetadata;

  /**
   * Embedded target type.
   */
  public type: TFunction | string;

  /**
   * Property name on which this embedded is attached.
   */
  public propertyName: string;

  /**
   * Gets full path to this embedded property (including embedded property name).
   * Full path is relevant when embedded is used inside other embeds (one or multiple nested).
   * For example it will return "counters.subcounters".
   */
  public propertyPath!: string;

  /**
   * Columns inside this embed.
   */
  public columns: Array<ColumnMetadata> = [];

  /**
   * Relations inside this embed.
   */
  public relations: Array<RelationMetadata> = [];

  /**
   * Entity listeners inside this embed.
   */
  public listeners: Array<EntityListenerMetadata> = [];

  /**
   * Indices applied to the embed columns.
   */
  public indices: Array<IndexMetadata> = [];

  /**
   * Uniques applied to the embed columns.
   */
  public uniques: Array<UniqueMetadata> = [];

  /**
   * Relation ids inside this embed.
   */
  public relationIds: Array<RelationIdMetadata> = [];

  /**
   * Relation counts inside this embed.
   */
  public relationCounts: Array<RelationCountMetadata> = [];

  /**
   * Nested embeddable in this embeddable (which has current embedded as parent embedded).
   */
  public embeddeds: Array<EmbeddedMetadata> = [];

  /**
   * Indicates if the entity should be instantiated using the constructor
   * or via allocating a new object via `Object.create()`.
   */
  public isAlwaysUsingConstructor = true;

  /**
   * Indicates if this embedded is in array mode.
   *
   * This option works only in mongodb.
   */
  public isArray = false;

  /**
   * Prefix of the embedded, used instead of propertyName.
   * If set to empty string or false, then prefix is not set at all.
   */
  public customPrefix: string | boolean | undefined;

  /**
   * Gets the prefix of the columns.
   * By default its a property name of the class where this prefix is.
   * But if custom prefix is set then it takes its value as a prefix.
   * However if custom prefix is set to empty string or false, then prefix to column is not applied at all.
   */
  public prefix!: string;

  /**
   * Returns array of property names of current embed and all its parent embeds.
   *
   * example: post[data][information][counters].id where "data", "information" and "counters" are embeds
   * we need to get value of "id" column from the post real entity object.
   * this method will return ["data", "information", "counters"]
   */
  public parentPropertyNames: Array<string> = [];

  /**
   * Returns array of prefixes of current embed and all its parent embeds.
   */
  public parentPrefixes: Array<string> = [];

  /**
   * Returns embed metadatas from all levels of the parent tree.
   *
   * example: post[data][information][counters].id where "data", "information" and "counters" are embeds
   * this method will return [embed metadata of data, embed metadata of information, embed metadata of counters]
   */
  public embeddedMetadataTree: Array<EmbeddedMetadata> = [];

  /**
   * Embed metadatas from all levels of the parent tree.
   *
   * example: post[data][information][counters].id where "data", "information" and "counters" are embeds
   * this method will return [embed metadata of data, embed metadata of information, embed metadata of counters]
   */
  public columnsFromTree: Array<ColumnMetadata> = [];

  /**
   * Relations of this embed and all relations from its child embeds.
   */
  public relationsFromTree: Array<RelationMetadata> = [];

  /**
   * Relations of this embed and all relations from its child embeds.
   */
  public listenersFromTree: Array<EntityListenerMetadata> = [];

  /**
   * Indices of this embed and all indices from its child embeds.
   */
  public indicesFromTree: Array<IndexMetadata> = [];

  /**
   * Uniques of this embed and all uniques from its child embeds.
   */
  public uniquesFromTree: Array<UniqueMetadata> = [];

  /**
   * Relation ids of this embed and all relation ids from its child embeds.
   */
  public relationIdsFromTree: Array<RelationIdMetadata> = [];

  /**
   * Relation counts of this embed and all relation counts from its child embeds.
   */
  public relationCountsFromTree: Array<RelationCountMetadata> = [];

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    args: EmbeddedMetadataArgs;
  }) {
    this.entityMetadata = options.entityMetadata;
    this.type = options.args.type();
    this.propertyName = options.args.propertyName;
    this.customPrefix = options.args.prefix;
    this.isArray = options.args.isArray;
  }

  // ---------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------

  /**
   * Creates a new embedded object.
   */
  public create(options?: { fromDeserializer?: boolean }): unknown {
    if (!(typeof this.type === 'function')) {
      return {};
    }

    if (options?.fromDeserializer || !this.isAlwaysUsingConstructor) {
      return Object.create(this.type.prototype as object);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      return new (this.type as typeof this.type.prototype.constructor)();
    }
  }

  // ---------------------------------------------------------------------
  // Builder Methods
  // ---------------------------------------------------------------------

  public build(connection: DataSource): this {
    this.embeddeds.forEach((embedded) => embedded.build(connection));
    this.prefix = this.buildPrefix(connection);
    this.parentPropertyNames = this.buildParentPropertyNames();
    this.parentPrefixes = this.buildParentPrefixes();
    this.propertyPath = this.parentPropertyNames.join('.');
    this.embeddedMetadataTree = this.buildEmbeddedMetadataTree();
    this.columnsFromTree = this.buildColumnsFromTree();
    this.relationsFromTree = this.buildRelationsFromTree();
    this.listenersFromTree = this.buildListenersFromTree();
    this.indicesFromTree = this.buildIndicesFromTree();
    this.uniquesFromTree = this.buildUniquesFromTree();
    this.relationIdsFromTree = this.buildRelationIdsFromTree();
    this.relationCountsFromTree = this.buildRelationCountsFromTree();

    // if (connection.options.entitySkipConstructor) {
    //   this.isAlwaysUsingConstructor = !connection.options.entitySkipConstructor;
    // }

    return this;
  }

  // ---------------------------------------------------------------------
  // Protected Methods
  // ---------------------------------------------------------------------

  protected buildPartialPrefix(): Array<string> {
    // if prefix option was not set or explicitly set to true - default prefix
    if (this.customPrefix === undefined || this.customPrefix === true) {
      return [this.propertyName];
    }

    // if prefix option was set to empty string or explicity set to false - disable prefix
    if (this.customPrefix === '' || this.customPrefix === false) {
      return [];
    }

    // use custom prefix
    if (typeof this.customPrefix === 'string') {
      return [this.customPrefix];
    }

    throw new TypeORMError(
      `Invalid prefix option given for ${this.entityMetadata.targetName}#${this.propertyName}`
    );
  }

  protected buildPrefix(connection: DataSource): string {
    // if (connection.driver.options.type === 'mongodb') return this.propertyName;

    const prefixes: Array<string> = [];
    if (this.parentEmbeddedMetadata)
      prefixes.push(this.parentEmbeddedMetadata.buildPrefix(connection));

    prefixes.push(...this.buildPartialPrefix());

    return prefixes.join('_'); // todo: use naming strategy instead of "_"  !!!
  }

  protected buildParentPropertyNames(): Array<string> {
    return this.parentEmbeddedMetadata
      ? this.parentEmbeddedMetadata
          .buildParentPropertyNames()
          .concat(this.propertyName)
      : [this.propertyName];
  }

  protected buildParentPrefixes(): Array<string> {
    return this.parentEmbeddedMetadata
      ? this.parentEmbeddedMetadata
          .buildParentPrefixes()
          .concat(this.buildPartialPrefix())
      : this.buildPartialPrefix();
  }

  protected buildEmbeddedMetadataTree(): Array<EmbeddedMetadata> {
    return this.parentEmbeddedMetadata
      ? this.parentEmbeddedMetadata.buildEmbeddedMetadataTree().concat(this)
      : [this];
  }

  protected buildColumnsFromTree(): Array<ColumnMetadata> {
    return this.embeddeds.reduce(
      (columns, embedded) => columns.concat(embedded.buildColumnsFromTree()),
      this.columns
    );
  }

  protected buildRelationsFromTree(): Array<RelationMetadata> {
    return this.embeddeds.reduce(
      (relations, embedded) =>
        relations.concat(embedded.buildRelationsFromTree()),
      this.relations
    );
  }

  protected buildListenersFromTree(): Array<EntityListenerMetadata> {
    return this.embeddeds.reduce(
      (relations, embedded) =>
        relations.concat(embedded.buildListenersFromTree()),
      this.listeners
    );
  }

  protected buildIndicesFromTree(): Array<IndexMetadata> {
    return this.embeddeds.reduce(
      (relations, embedded) =>
        relations.concat(embedded.buildIndicesFromTree()),
      this.indices
    );
  }

  protected buildUniquesFromTree(): Array<UniqueMetadata> {
    return this.embeddeds.reduce(
      (relations, embedded) =>
        relations.concat(embedded.buildUniquesFromTree()),
      this.uniques
    );
  }

  protected buildRelationIdsFromTree(): Array<RelationIdMetadata> {
    return this.embeddeds.reduce(
      (relations, embedded) =>
        relations.concat(embedded.buildRelationIdsFromTree()),
      this.relationIds
    );
  }

  protected buildRelationCountsFromTree(): Array<RelationCountMetadata> {
    return this.embeddeds.reduce(
      (relations, embedded) =>
        relations.concat(embedded.buildRelationCountsFromTree()),
      this.relationCounts
    );
  }
}
