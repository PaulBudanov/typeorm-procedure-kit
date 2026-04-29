import type { TFunction } from '../../types/utility.types.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import { DataSource } from '../data-source/DataSource.js';
import type { UpsertType } from '../driver/types/UpsertType.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { OrderByCondition } from '../find-options/OrderByCondition.js';
import { ColumnMetadata } from '../metadata/ColumnMetadata.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';

import { Alias } from './Alias.js';
import { JoinAttribute } from './JoinAttribute.js';
import { QueryBuilder } from './QueryBuilder.js';
import type { QueryBuilderCteOptions } from './QueryBuilderCte.js';
import { RelationCountAttribute } from './relation-count/RelationCountAttribute.js';
import { RelationIdAttribute } from './relation-id/RelationIdAttribute.js';
import type { SelectQuery } from './SelectQuery.js';
import type { SelectQueryBuilderOption } from './SelectQueryBuilderOption.js';
import type { WhereClause } from './WhereClause.js';

/**
 * Contains all properties of the QueryBuilder that needs to be build a final query.
 */
export class QueryExpressionMap {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Strategy to load relations.
   */
  public relationLoadStrategy: 'join' | 'query' = 'join';

  /**
   * Indicates if QueryBuilder used to select entities and not a raw results.
   */
  public queryEntity = false;

  /**
   * Main alias is a main selection object selected by QueryBuilder.
   */
  public mainAlias?: Alias;

  /**
   * All aliases (including main alias) used in the query.
   */
  public aliases: Array<Alias> = [];

  /**
   * Represents query type. QueryBuilder is able to build SELECT, UPDATE and DELETE queries.
   */
  public queryType:
    | 'select'
    | 'update'
    | 'delete'
    | 'insert'
    | 'relation'
    | 'soft-delete'
    | 'restore' = 'select';

  /**
   * Data needs to be SELECT-ed.
   */
  public selects: Array<SelectQuery> = [];

  /**
   * Max execution time in millisecond.
   */
  public maxExecutionTime = 0;

  /**
   * Whether SELECT is DISTINCT.
   */
  public selectDistinct = false;

  /**
   * SELECT DISTINCT ON query (postgres).
   */
  public selectDistinctOn: Array<string> = [];

  /**
   * FROM-s to be selected.
   */
  // froms: { target: string, alias: string }[] = [];

  /**
   * If update query was used, it needs "update set" - properties which will be updated by this query.
   * If insert query was used, it needs "insert set" - values that needs to be inserted.
   */
  public valuesSet?: ObjectLiteral | Array<ObjectLiteral>;

  /**
   * Optional returning (or output) clause for insert, update or delete queries.
   */
  public returning!: string | Array<string>;

  /**
   * Extra returning columns to be added to the returning statement if driver supports it.
   */
  public extraReturningColumns: Array<ColumnMetadata> = [];

  /**
   * Optional on conflict statement used in insertion query in postgres.
   */
  public onConflict = '';

  /**
   * Optional on ignore statement used in insertion query in databases.
   */
  public onIgnore = false;

  /**
   * Optional on update statement used in insertion query in databases.
   */
  public onUpdate!: {
    conflict?: string | Array<string>;
    columns?: Array<string>;
    overwrite?: Array<string>;
    skipUpdateIfNoValuesChanged?: boolean;
    indexPredicate?: string;
    upsertType?: UpsertType;
    overwriteCondition?: Array<WhereClause>;
  };

  /**
   * JOIN queries.
   */
  public joinAttributes: Array<JoinAttribute> = [];

  /**
   * RelationId queries.
   */
  public relationIdAttributes: Array<RelationIdAttribute> = [];

  /**
   * Relation count queries.
   */
  public relationCountAttributes: Array<RelationCountAttribute> = [];

  /**
   * WHERE queries.
   */
  public wheres: Array<WhereClause> = [];

  /**
   * HAVING queries.
   */
  public havings: Array<{ type: 'simple' | 'and' | 'or'; condition: string }> =
    [];

  /**
   * ORDER BY queries.
   */
  public orderBys: OrderByCondition = {};

  /**
   * GROUP BY queries.
   */
  public groupBys: Array<string> = [];

  /**
   * LIMIT query.
   */
  public limit?: number;

  /**
   * OFFSET query.
   */
  public offset?: number;

  /**
   * Number of rows to skip of result using pagination.
   */
  public skip?: number;

  /**
   * Number of rows to take using pagination.
   */
  public take?: number;

  /**
   * Use certain index for the query.
   *
   * SELECT * FROM table_name USE INDEX (col1_index, col2_index) WHERE col1=1 AND col2=2 AND col3=3;
   */
  public useIndex?: string;

  /**
   * Locking mode.
   */
  public lockMode?:
    | 'optimistic'
    | 'pessimistic_read'
    | 'pessimistic_write'
    | 'dirty_read'
    /*
            "pessimistic_partial_write" and "pessimistic_write_or_fail" are deprecated and
            will be removed in a future version.

            Use onLocked instead.
         */
    | 'pessimistic_partial_write'
    | 'pessimistic_write_or_fail'
    | 'for_no_key_update'
    | 'for_key_share';

  /**
   * Current version of the entity, used for locking.
   */
  public lockVersion?: number | Date;

  /**
   * Tables to be specified in the "FOR UPDATE OF" clause, referred by their alias
   */
  public lockTables?: Array<string>;

  /**
   * Modify behavior when encountering locked rows. NOWAIT or SKIP LOCKED
   */
  public onLocked?: 'nowait' | 'skip_locked';

  /**
   * Indicates if soft-deleted rows should be included in entity result.
   * By default the soft-deleted rows are not included.
   */
  public withDeleted = false;

  /**
   * Parameters used to be escaped in final query.
   */
  public parameters: ObjectLiteral = {};

  /**
   * Disables driver quoting for aliases, table names, and column names when true.
   *
   * Defaults to true for this kit, so generated SQL keeps identifiers unquoted
   * unless query-builder code explicitly enables quoting or forces it per call.
   */
  public isQuotingDisabled = true;

  /**
   * Indicates if virtual columns should be included in entity result.
   *
   * todo: what to do with it? is it properly used? what about persistence?
   */
  public enableRelationIdValues = false;

  /**
   * Extra where condition appended to the end of original where conditions with AND keyword.
   * Original condition will be wrapped into brackets.
   */
  public extraAppendedAndWhereCondition = '';

  /**
   * Indicates if query builder creates a subquery.
   */
  public subQuery = false;

  /**
   * Indicates if property names are prefixed with alias names during property replacement.
   * By default this is enabled, however we need this because aliases are not supported in UPDATE and DELETE queries,
   * but user can use them in WHERE expressions.
   */
  public aliasNamePrefixingEnabled = true;

  /**
   * Indicates if query result cache is enabled or not.
   * It is undefined by default to avoid overriding the `alwaysEnabled` config
   */
  public cache?: boolean;

  /**
   * Time in milliseconds in which cache will expire.
   * If not set then global caching time will be used.
   */
  public cacheDuration!: number;

  /**
   * Cache id.
   * Used to identifier your cache queries.
   */
  public cacheId!: string;

  /**
   * Options that define QueryBuilder behaviour.
   */
  public options: Array<SelectQueryBuilderOption> = [];

  /**
   * Property path of relation to work with.
   * Used in relational query builder.
   */
  public relationPropertyPath!: string;

  /**
   * Entity (target) which relations will be updated.
   */
  public of: unknown | Array<unknown>;

  /**
   * List of columns where data should be inserted.
   * Used in INSERT query.
   */
  public insertColumns: Array<string> = [];

  /**
   * Used if user wants to update or delete a specific entities.
   */
  public whereEntities: Array<ObjectLiteral> = [];

  /**
   * Indicates if entity must be updated after insertion / updation.
   * This may produce extra query or use RETURNING / OUTPUT statement (depend on database).
   */
  public updateEntity = true;

  /**
   * Indicates if listeners and subscribers must be called before and after query execution.
   */
  public callListeners = true;

  /**
   * Indicates if query must be wrapped into transaction.
   */
  public useTransaction = false;

  /**
   * Indicates if query should be time travel query
   * https://www.cockroachlabs.com/docs/stable/as-of-system-time.html
   */
  public timeTravel?: boolean | string;

  /**
   * Extra parameters.
   *
   * @deprecated Use standard parameters instead
   */
  public nativeParameters: ObjectLiteral = {};

  /**
   * Query Comment to include extra information for debugging or other purposes.
   */
  public comment?: string;

  /**
   * Items from an entity that have been locally generated & are recorded here for later use.
   * Examples include the UUID generation when the database does not natively support it.
   * These are included in the entity index order.
   */
  public locallyGenerated: Record<number, ObjectLiteral> = {};

  public commonTableExpressions: Array<{
    queryBuilder: QueryBuilder<ObjectLiteral> | string;
    alias: string;
    options: QueryBuilderCteOptions;
  }> = [];

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(protected connection: DataSource) {
    if (connection.options.relationLoadStrategy)
      this.relationLoadStrategy = connection.options.relationLoadStrategy;

    if (
      connection.options.isQuotingDisabled !== undefined &&
      connection.options.isQuotingDisabled !== null
    )
      this.isQuotingDisabled = connection.options.isQuotingDisabled;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Get all ORDER BY queries - if order by is specified by user then it uses them,
   * otherwise it uses default entity order by if it was set.
   */
  public get allOrderBys(): OrderByCondition {
    if (
      !Object.keys(this.orderBys).length &&
      this.mainAlias!.hasMetadata &&
      this.options.indexOf('disable-global-order') === -1
    ) {
      const entityOrderBy = this.mainAlias!.metadata.orderBy || {};
      return Object.keys(entityOrderBy).reduce((orderBy, key) => {
        const orderByKey = this.mainAlias!.name + '.' + key;
        orderBy[orderByKey] = entityOrderBy[
          key
        ] as (typeof orderBy)[keyof typeof orderBy];
        return orderBy;
      }, {} as OrderByCondition);
    }

    return this.orderBys;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a main alias and adds it to the current expression map.
   */
  public setMainAlias(alias: Alias): Alias {
    // if main alias is already set then remove it from the array
    // if (this.mainAlias)
    //     this.aliases.splice(this.aliases.indexOf(this.mainAlias));

    // set new main alias
    this.mainAlias = alias;

    return alias;
  }

  /**
   * Creates a new alias and adds it to the current expression map.
   */
  public createAlias(options: {
    type: 'from' | 'select' | 'join' | 'other';
    name?: string;
    target?: TFunction | string;
    tablePath?: string;
    subQuery?: string;
    metadata?: EntityMetadata;
  }): Alias {
    let aliasName = options.name;
    if (!aliasName && options.tablePath) aliasName = options.tablePath;
    if (!aliasName && typeof options.target === 'function')
      aliasName = options.target.name;
    if (!aliasName && typeof options.target === 'string')
      aliasName = options.target;

    const alias = new Alias();
    alias.type = options.type;
    if (aliasName) alias.name = aliasName;
    if (options.metadata) alias.metadata = options.metadata;
    if (options.target && !alias.hasMetadata)
      alias.metadata = this.connection.getMetadata(options.target);
    if (options.tablePath) alias.tablePath = options.tablePath;
    if (options.subQuery) alias.subQuery = options.subQuery;

    this.aliases.push(alias);
    return alias;
  }

  /**
   * Finds alias with the given name.
   * If alias was not found it throw an exception.
   */
  public findAliasByName(aliasName: string): Alias {
    const alias = this.aliases.find((alias) => alias.name === aliasName);
    if (!alias)
      throw new TypeORMError(
        `"${aliasName}" alias was not found. Maybe you forgot to join it?`
      );

    return alias;
  }

  public findColumnByAliasExpression(
    aliasExpression: string
  ): ColumnMetadata | undefined {
    const [aliasName, propertyPath] = aliasExpression.split('.');
    const alias = this.findAliasByName(aliasName!);
    return alias.metadata.findColumnWithPropertyName(propertyPath!);
  }

  /**
   * Gets relation metadata of the relation this query builder works with.
   *
   * todo: add proper exceptions
   */
  public get relationMetadata(): RelationMetadata {
    if (!this.mainAlias)
      throw new TypeORMError(`Entity to work with is not specified!`); // todo: better message

    const relationMetadata =
      this.mainAlias.metadata.findRelationWithPropertyPath(
        this.relationPropertyPath
      );
    if (!relationMetadata)
      throw new TypeORMError(
        `Relation ${this.relationPropertyPath} was not found in entity ${this.mainAlias.name}`
      ); // todo: better message

    return relationMetadata;
  }

  /**
   * Copies all properties of the current QueryExpressionMap into a new one.
   * Useful when QueryBuilder needs to create a copy of itself.
   */
  public clone(): QueryExpressionMap {
    const map = new QueryExpressionMap(this.connection);
    map.queryType = this.queryType;
    map.selects = this.selects.map((select) => select);
    map.maxExecutionTime = this.maxExecutionTime;
    map.selectDistinct = this.selectDistinct;
    map.selectDistinctOn = this.selectDistinctOn;
    this.aliases.forEach((alias) => map.aliases.push(new Alias(alias)));
    map.relationLoadStrategy = this.relationLoadStrategy;
    map.mainAlias = this.mainAlias;
    map.valuesSet = this.valuesSet;
    map.returning = this.returning;
    map.onConflict = this.onConflict;
    map.onIgnore = this.onIgnore;
    map.onUpdate = this.onUpdate;
    map.joinAttributes = this.joinAttributes.map(
      (join) => new JoinAttribute(this.connection, this, join)
    );
    map.relationIdAttributes = this.relationIdAttributes.map(
      (relationId) => new RelationIdAttribute(this, relationId)
    );
    map.relationCountAttributes = this.relationCountAttributes.map(
      (relationCount) => new RelationCountAttribute(this, relationCount)
    );
    map.wheres = this.wheres.map((where) => ({ ...where }));
    map.havings = this.havings.map((having) => ({ ...having }));
    map.orderBys = Object.assign({}, this.orderBys);
    map.groupBys = this.groupBys.map((groupBy) => groupBy);
    map.limit = this.limit;
    map.offset = this.offset;
    map.skip = this.skip;
    map.take = this.take;
    map.useIndex = this.useIndex;
    map.lockMode = this.lockMode;
    map.onLocked = this.onLocked;
    map.lockVersion = this.lockVersion;
    map.lockTables = this.lockTables;
    map.withDeleted = this.withDeleted;
    map.parameters = Object.assign({}, this.parameters);
    map.isQuotingDisabled = this.isQuotingDisabled;
    map.enableRelationIdValues = this.enableRelationIdValues;
    map.extraAppendedAndWhereCondition = this.extraAppendedAndWhereCondition;
    map.subQuery = this.subQuery;
    map.aliasNamePrefixingEnabled = this.aliasNamePrefixingEnabled;
    map.cache = this.cache;
    map.cacheId = this.cacheId;
    map.cacheDuration = this.cacheDuration;
    map.relationPropertyPath = this.relationPropertyPath;
    map.of = this.of;
    map.insertColumns = this.insertColumns;
    map.whereEntities = this.whereEntities;
    map.updateEntity = this.updateEntity;
    map.callListeners = this.callListeners;
    map.useTransaction = this.useTransaction;
    map.timeTravel = this.timeTravel;
    map.nativeParameters = Object.assign({}, this.nativeParameters);
    map.comment = this.comment;
    map.commonTableExpressions = this.commonTableExpressions.map(
      (cteOptions) => ({
        alias: cteOptions.alias,
        queryBuilder:
          typeof cteOptions.queryBuilder === 'string'
            ? cteOptions.queryBuilder
            : cteOptions.queryBuilder.clone(),
        options: cteOptions.options,
      })
    );
    return map;
  }
}
