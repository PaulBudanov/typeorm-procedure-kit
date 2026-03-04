import type { TFunction } from '../../types/utility.types.js';
import { StringUtilities } from '../../utils/string-utilities.js';
import type { EntityTarget } from '../common/EntityTarget.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { DataSource } from '../data-source/DataSource.js';
import type { Driver, ReturningType } from '../driver/Driver.js';
import { OracleDriver } from '../driver/oracle/OracleDriver.js';
import { EntityPropertyNotFoundError } from '../error/EntityPropertyNotFoundError.js';
import { TypeORMError } from '../error/TypeORMError.js';
import { FindOperator } from '../find-options/FindOperator.js';
import { In } from '../find-options/operator/In.js';
import type { ColumnMetadata } from '../metadata/ColumnMetadata.js';
import type { EntityMetadata } from '../metadata/EntityMetadata.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
import { escapeRegExp } from '../util/escapeRegExp.js';
import { InstanceChecker } from '../util/InstanceChecker.js';

import { Alias } from './Alias.js';
import { Brackets } from './Brackets.js';
import type { DeleteQueryBuilder } from './DeleteQueryBuilder.js';
import type { InsertQueryBuilder } from './InsertQueryBuilder.js';
import { NotBrackets } from './NotBrackets.js';
import type { QueryBuilderCteOptions } from './QueryBuilderCte.js';
import { QueryExpressionMap } from './QueryExpressionMap.js';
import type { QueryDeepPartialEntity } from './QueryPartialEntity.js';
import type { RelationQueryBuilder } from './RelationQueryBuilder.js';
import type { SelectQueryBuilder } from './SelectQueryBuilder.js';
import type { SoftDeleteQueryBuilder } from './SoftDeleteQueryBuilder.js';
import type { UpdateQueryBuilder } from './UpdateQueryBuilder.js';
import type { WhereClause, WhereClauseCondition } from './WhereClause.js';
import type { WhereExpressionBuilder } from './WhereExpressionBuilder.js';

// todo: completely cover query builder with tests
// todo: entityOrProperty can be target name. implement proper behaviour if it is.
// todo: check in persistment if id exist on object and throw exception (can be in partial selection?)
// todo: fix problem with long aliases eg getMaxIdentifierLength
// todo: fix replacing in .select("COUNT(post.id) AS cnt") statement
// todo: implement joinAlways in relations and relationId
// todo: finish partial selection
// todo: sugar methods like: .addCount and .selectCount, selectCountAndMap, selectSum, selectSumAndMap, ...
// todo: implement @Select decorator
// todo: add select and map functions

// todo: implement relation/entity loading and setting them into properties within a separate query
// .loadAndMap("post.categories", "post.categories", qb => ...)
// .loadAndMap("post.categories", Category, qb => ...)

/**
 * Allows to build complex sql queries in a fashion way and execute those queries.
 */
export abstract class QueryBuilder<Entity = unknown> {
  public readonly '@instanceof' = Symbol.for('QueryBuilder');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Connection on which QueryBuilder was created.
   */
  public readonly connection: DataSource;

  /**
   * Driver used by this QueryBuilder.
   */
  public get driver(): Driver {
    return this.connection.driver;
  }

  /**
   * Contains all properties of the QueryBuilder that needs to be build a final query.
   */
  public readonly expressionMap: QueryExpressionMap;

  // -------------------------------------------------------------------------
  // Protected Properties
  // -------------------------------------------------------------------------

  /**
   * Query runner used to execute query builder query.
   */
  protected queryRunner?: QueryRunner;

  /**
   * If QueryBuilder was created in a subquery mode then its parent QueryBuilder (who created subquery) will be stored here.
   */
  public parentQueryBuilder!: QueryBuilder<ObjectLiteral>;

  /**
   * Memo to help keep place of current parameter index for `createParameter`
   */
  private parameterIndex = 0;

  /**
   * Contains all registered query builder classes.
   */
  private static queryBuilderRegistry: Record<string, unknown> = {};

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * QueryBuilder can be initialized from given Connection and QueryRunner objects or from given other QueryBuilder.
   */
  public constructor(queryBuilder: QueryBuilder<ObjectLiteral>);

  /**
   * QueryBuilder can be initialized from given Connection and QueryRunner objects or from given other QueryBuilder.
   */
  public constructor(connection: DataSource, queryRunner?: QueryRunner);

  /**
   * QueryBuilder can be initialized from given Connection and QueryRunner objects or from given other QueryBuilder.
   */
  public constructor(
    connectionOrQueryBuilder: DataSource | QueryBuilder<ObjectLiteral>,
    queryRunner?: QueryRunner
  ) {
    if (InstanceChecker.isDataSource(connectionOrQueryBuilder)) {
      this.connection = connectionOrQueryBuilder;
      this.queryRunner = queryRunner;
      this.expressionMap = new QueryExpressionMap(this.connection);
    } else {
      this.connection = connectionOrQueryBuilder.connection;
      this.queryRunner = connectionOrQueryBuilder.queryRunner;
      this.expressionMap = connectionOrQueryBuilder.expressionMap.clone();
    }
  }

  public static registerQueryBuilderClass(
    name: string,
    factory: (
      qb: DataSource | QueryBuilder<ObjectLiteral>
    ) => QueryBuilder<ObjectLiteral>
  ): void {
    QueryBuilder.queryBuilderRegistry[name] = factory;
  }

  // -------------------------------------------------------------------------
  // Abstract Methods
  // -------------------------------------------------------------------------

  /**
   * Gets generated SQL query without parameters being replaced.
   */
  public abstract getQuery(): string;

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Gets the main alias string used in this query builder.
   */
  public get alias(): string {
    if (!this.expressionMap.mainAlias)
      throw new TypeORMError(`Main alias is not set`); // todo: better exception

    return this.expressionMap.mainAlias.name;
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates SELECT query.
   * Replaces all previous selections if they exist.
   */
  public select(): SelectQueryBuilder<Entity>;

  /**
   * Creates SELECT query and selects given data.
   * Replaces all previous selections if they exist.
   */
  public select(
    selection: string,
    selectionAliasName?: string
  ): SelectQueryBuilder<Entity>;

  /**
   * Creates SELECT query and selects given data.
   * Replaces all previous selections if they exist.
   */
  public select(selection: Array<string>): SelectQueryBuilder<Entity>;

  /**
   * Creates SELECT query and selects given data.
   * Replaces all previous selections if they exist.
   */
  public select(
    selection?: string | Array<string>,
    selectionAliasName?: string
  ): SelectQueryBuilder<Entity> {
    this.expressionMap.queryType = 'select';
    if (Array.isArray(selection)) {
      this.expressionMap.selects = selection.map((selection) => ({
        selection: selection,
      }));
    } else if (selection) {
      this.expressionMap.selects = [
        { selection: selection, aliasName: selectionAliasName },
      ];
    }

    if (InstanceChecker.isSelectQueryBuilder(this))
      return this as unknown as SelectQueryBuilder<Entity>;

    const selectQueryBuilder = QueryBuilder.queryBuilderRegistry[
      'SelectQueryBuilder'
    ]! as TFunction;
    return selectQueryBuilder(this) as SelectQueryBuilder<Entity>;
  }

  /**
   * Creates INSERT query.
   */
  public insert(): InsertQueryBuilder<ObjectLiteral> {
    this.expressionMap.queryType = 'insert';

    if (InstanceChecker.isInsertQueryBuilder(this)) return this;

    return (
      QueryBuilder.queryBuilderRegistry['InsertQueryBuilder']! as TFunction
    )(this) as InsertQueryBuilder<ObjectLiteral>;
  }

  /**
   * Creates UPDATE query and applies given update values.
   */
  public update(): UpdateQueryBuilder<ObjectLiteral>;

  /**
   * Creates UPDATE query and applies given update values.
   */
  public update(
    updateSet: QueryDeepPartialEntity<Entity>
  ): UpdateQueryBuilder<ObjectLiteral>;

  /**
   * Creates UPDATE query for the given entity and applies given update values.
   */
  public update<Entity extends ObjectLiteral>(
    entity: EntityTarget<Entity>,
    updateSet?: QueryDeepPartialEntity<Entity>
  ): UpdateQueryBuilder<Entity>;

  /**
   * Creates UPDATE query for the given table name and applies given update values.
   */
  public update(
    tableName: string,
    updateSet?: QueryDeepPartialEntity<Entity>
  ): UpdateQueryBuilder<ObjectLiteral>;

  /**
   * Creates UPDATE query and applies given update values.
   */
  public update(
    entityOrTableNameUpdateSet?: EntityTarget<ObjectLiteral> | ObjectLiteral,
    maybeUpdateSet?: ObjectLiteral
  ): UpdateQueryBuilder<ObjectLiteral> {
    const updateSet = maybeUpdateSet
      ? maybeUpdateSet
      : (entityOrTableNameUpdateSet as ObjectLiteral | undefined);
    entityOrTableNameUpdateSet = InstanceChecker.isEntitySchema(
      entityOrTableNameUpdateSet
    )
      ? entityOrTableNameUpdateSet.options.name
      : entityOrTableNameUpdateSet;

    if (
      typeof entityOrTableNameUpdateSet === 'function' ||
      typeof entityOrTableNameUpdateSet === 'string'
    ) {
      const mainAlias = this.createFromAlias(entityOrTableNameUpdateSet);
      this.expressionMap.setMainAlias(mainAlias);
    }

    this.expressionMap.queryType = 'update';
    this.expressionMap.valuesSet = updateSet;

    if (InstanceChecker.isUpdateQueryBuilder(this)) return this;

    return (
      QueryBuilder.queryBuilderRegistry['UpdateQueryBuilder']! as TFunction
    )(this) as UpdateQueryBuilder<ObjectLiteral>;
  }

  /**
   * Creates DELETE query.
   */
  public delete(): DeleteQueryBuilder<ObjectLiteral> {
    this.expressionMap.queryType = 'delete';

    if (InstanceChecker.isDeleteQueryBuilder(this)) return this;

    return (
      QueryBuilder.queryBuilderRegistry['DeleteQueryBuilder']! as TFunction
    )(this) as DeleteQueryBuilder<ObjectLiteral>;
  }

  public softDelete(): SoftDeleteQueryBuilder<ObjectLiteral> {
    this.expressionMap.queryType = 'soft-delete';

    if (InstanceChecker.isSoftDeleteQueryBuilder(this))
      return this as SoftDeleteQueryBuilder<ObjectLiteral>;

    return (
      QueryBuilder.queryBuilderRegistry['SoftDeleteQueryBuilder']! as TFunction
    )(this) as SoftDeleteQueryBuilder<ObjectLiteral>;
  }

  public restore(): SoftDeleteQueryBuilder<ObjectLiteral> {
    this.expressionMap.queryType = 'restore';

    if (InstanceChecker.isSoftDeleteQueryBuilder(this))
      return this as SoftDeleteQueryBuilder<ObjectLiteral>;

    return (
      QueryBuilder.queryBuilderRegistry['SoftDeleteQueryBuilder']! as TFunction
    )(this) as SoftDeleteQueryBuilder<ObjectLiteral>;
  }

  /**
   * Sets entity's relation with which this query builder gonna work.
   */
  public relation(propertyPath: string): RelationQueryBuilder<ObjectLiteral>;

  /**
   * Sets entity's relation with which this query builder gonna work.
   */
  public relation<T extends ObjectLiteral>(
    entityTarget: EntityTarget<T>,
    propertyPath: string
  ): RelationQueryBuilder<T>;

  /**
   * Sets entity's relation with which this query builder gonna work.
   */
  public relation(
    entityTargetOrPropertyPath: TFunction | string,
    maybePropertyPath?: string
  ): RelationQueryBuilder<ObjectLiteral> {
    const entityTarget =
      arguments.length === 2 ? entityTargetOrPropertyPath : undefined;
    const propertyPath =
      arguments.length === 2
        ? (maybePropertyPath as string)
        : (entityTargetOrPropertyPath as string);

    this.expressionMap.queryType = 'relation';
    this.expressionMap.relationPropertyPath = propertyPath;

    if (entityTarget) {
      const mainAlias = this.createFromAlias(entityTarget);
      this.expressionMap.setMainAlias(mainAlias);
    }

    if (InstanceChecker.isRelationQueryBuilder(this)) return this;

    return (
      QueryBuilder.queryBuilderRegistry['RelationQueryBuilder']! as TFunction
    )(this) as RelationQueryBuilder<ObjectLiteral>;
  }

  /**
   * Checks if given relation exists in the entity.
   * Returns true if relation exists, false otherwise.
   *
   * todo: move this method to manager? or create a shortcut?
   */
  public hasRelation<T>(target: EntityTarget<T>, relation: string): boolean;

  /**
   * Checks if given relations exist in the entity.
   * Returns true if relation exists, false otherwise.
   *
   * todo: move this method to manager? or create a shortcut?
   */
  public hasRelation<T>(
    target: EntityTarget<T>,
    relation: Array<string>
  ): boolean;

  /**
   * Checks if given relation or relations exist in the entity.
   * Returns true if relation exists, false otherwise.
   *
   * todo: move this method to manager? or create a shortcut?
   */
  public hasRelation<T>(
    target: EntityTarget<T>,
    relation: string | Array<string>
  ): boolean {
    const entityMetadata = this.connection.getMetadata(
      target as EntityTarget<ObjectLiteral>
    );
    const relations = Array.isArray(relation) ? relation : [relation];
    return relations.every((relation) => {
      return !!entityMetadata.findRelationWithPropertyPath(relation);
    });
  }

  /**
   * Check the existence of a parameter for this query builder.
   */
  public hasParameter(key: string): boolean {
    return (
      this.parentQueryBuilder?.hasParameter(key) ||
      key in this.expressionMap.parameters
    );
  }

  /**
   * Sets parameter name and its value.
   *
   * The key for this parameter may contain numbers, letters, underscores, or periods.
   */
  public setParameter(key: string, value: unknown): this {
    if (typeof value === 'function') {
      throw new TypeORMError(
        `() => unknown parameter isn't supported in the parameters. Please check "${key}" parameter.`
      );
    }

    if (!key.match(/^([A-Za-z0-9_.]+)$/)) {
      throw new TypeORMError(
        'QueryBuilder parameter keys may only contain numbers, letters, underscores, or periods.'
      );
    }

    if (this.parentQueryBuilder) {
      this.parentQueryBuilder.setParameter(key, value);
    }

    this.expressionMap.parameters[key] = value as ObjectLiteral;
    return this;
  }

  /**
   * Adds all parameters from the given object.
   */
  public setParameters(parameters: ObjectLiteral): this {
    for (const [key, value] of Object.entries(parameters)) {
      this.setParameter(key, value);
    }

    return this;
  }

  protected createParameter(value: unknown): string {
    let parameterName;

    do {
      parameterName = `orm_param_${this.parameterIndex++}`;
    } while (this.hasParameter(parameterName));

    this.setParameter(parameterName, value);

    return `:${parameterName}`;
  }

  /**
   * Adds native parameters from the given object.
   *
   * @deprecated Use `setParameters` instead
   */
  public setNativeParameters(parameters: ObjectLiteral): this {
    // set parent query builder parameters as well in sub-query mode
    if (this.parentQueryBuilder) {
      this.parentQueryBuilder.setNativeParameters(parameters);
    }

    Object.keys(parameters).forEach((key) => {
      this.expressionMap.nativeParameters[key] = parameters[key];
    });
    return this;
  }

  /**
   * Gets all parameters.
   */
  public getParameters(): ObjectLiteral {
    const parameters: ObjectLiteral = Object.assign(
      {},
      this.expressionMap.parameters
    );

    // add discriminator column parameter if it exist
    if (
      this.expressionMap.mainAlias &&
      this.expressionMap.mainAlias.hasMetadata
    ) {
      const metadata = this.expressionMap.mainAlias!.metadata;
      if (metadata.discriminatorColumn && metadata.parentEntityMetadata) {
        const values = metadata.childEntityMetadatas
          .filter((childMetadata) => childMetadata.discriminatorColumn)
          .map((childMetadata) => childMetadata.discriminatorValue);
        values.push(metadata.discriminatorValue);
        parameters['discriminatorColumnValues'] = values;
      }
    }

    return parameters;
  }

  /**
   * Prints sql to stdout using console.log.
   */
  public printSql(): this {
    // TODO rename to logSql()
    const [query, parameters] = this.getQueryAndParameters();
    this.connection.logger.logQuery(query, parameters);
    return this;
  }

  /**
   * Gets generated sql that will be executed.
   * Parameters in the query are escaped for the currently used driver.
   */
  public getSql(): string {
    return this.getQueryAndParameters()[0];
  }

  /**
   * Gets query to be executed with all parameters used in it.
   */
  public getQueryAndParameters(): [string, Array<unknown>] {
    // this execution order is important because getQuery method generates this.expressionMap.nativeParameters values
    const query = this.getQuery();
    const parameters = this.getParameters();
    return this.driver.escapeQueryWithParameters(
      query,
      parameters,
      this.expressionMap.nativeParameters
    );
  }

  /**
   * Executes sql generated by query builder and returns raw database results.
   */
  public async execute(): Promise<unknown> {
    const [sql, parameters] = this.getQueryAndParameters();
    const queryRunner = this.obtainQueryRunner();
    try {
      return await queryRunner.query(sql, parameters); // await is needed here because we are using finally
    } finally {
      if (queryRunner !== this.queryRunner) {
        // means we created our own query runner
        await queryRunner.release();
      }
    }
  }

  /**
   * Creates a completely new query builder.
   * Uses same query runner as current QueryBuilder.
   */
  public createQueryBuilder<T = ObjectLiteral>(queryRunner?: QueryRunner): T {
    return new (this.constructor as new (
      connection: DataSource,
      queryRunner?: QueryRunner
    ) => T)(this.connection, queryRunner ?? this.queryRunner) as T;
  }

  /**
   * Clones query builder as it is.
   * Note: it uses new query runner, if you want query builder that uses exactly same query runner,
   * you can create query builder using its constructor, for example new SelectQueryBuilder(queryBuilder)
   * where queryBuilder is cloned QueryBuilder.
   */
  public clone(): QueryBuilder<Entity> {
    return new (this.constructor as new (
      qb: QueryBuilder<Entity>
    ) => QueryBuilder<Entity>)(this as QueryBuilder<Entity>);
  }
  /**
   * Includes a Query comment in the query builder.  This is helpful for debugging purposes,
   * such as finding a specific query in the database server's logs, or for categorization using
   * an APM product.
   */
  public comment(comment: string): this {
    this.expressionMap.comment = comment;
    return this;
  }

  /**
   * Disables escaping.
   */
  public disableEscaping(): this {
    this.expressionMap.isQuotingDisabled = true;
    return this;
  }
  public enableEscaping(): this {
    this.expressionMap.isQuotingDisabled = false;
    return this;
  }

  /**
   * Escapes table name, column name or alias name using current database's escaping character.
   */
  public escape(name: string, isNeedQuote = false): string {
    if (this.expressionMap.isQuotingDisabled && !isNeedQuote) return name;
    return this.driver.escape(name);
  }

  /**
   * Sets or overrides query builder's QueryRunner.
   */
  public setQueryRunner(queryRunner: QueryRunner): this {
    this.queryRunner = queryRunner;
    return this;
  }

  /**
   * Indicates if listeners and subscribers must be called before and after query execution.
   * Enabled by default.
   */
  public callListeners(enabled: boolean): this {
    this.expressionMap.callListeners = enabled;
    return this;
  }

  /**
   * If set to true the query will be wrapped into a transaction.
   */
  public useTransaction(enabled: boolean): this {
    this.expressionMap.useTransaction = enabled;
    return this;
  }

  /**
   * Adds CTE to query
   */
  public addCommonTableExpression(
    queryBuilder: QueryBuilder<ObjectLiteral> | string,
    alias: string,
    options?: QueryBuilderCteOptions
  ): this {
    this.expressionMap.commonTableExpressions.push({
      queryBuilder,
      alias,
      options: options || {},
    });
    return this;
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  /**
   * Gets escaped table name with schema name if SqlServer driver used with custom
   * schema name, otherwise returns escaped table name.
   */
  protected getTableName(tablePath: string): string {
    return tablePath
      .split('.')
      .map((i) => {
        // this condition need because in SQL Server driver when custom database name was specified and schema name was not, we got `dbName..tableName` string, and doesn't need to escape middle empty string
        if (i === '') return i;
        return this.escape(i);
      })
      .join('.');
  }

  /**
   * Gets name of the table where insert should be performed.
   */
  protected getMainTableName(): string {
    if (!this.expressionMap.mainAlias)
      throw new TypeORMError(
        `Entity where values should be inserted is not specified. Call "qb.into(entity)" method to specify it.`
      );

    if (this.expressionMap.mainAlias.hasMetadata)
      return this.expressionMap.mainAlias.metadata.tablePath;

    return this.expressionMap.mainAlias.tablePath!;
  }

  /**
   * Specifies FROM which entity's table select/update/delete will be executed.
   * Also sets a main string alias of the selection data.
   */
  protected createFromAlias(
    entityTarget:
      | EntityTarget<ObjectLiteral>
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    aliasName?: string
  ): Alias {
    // if table has a metadata then find it to properly escape its properties
    // const metadata = this.connection.entityMetadatas.find(metadata => metadata.tableName === tableName);
    if (
      this.connection.hasMetadata(entityTarget as EntityTarget<ObjectLiteral>)
    ) {
      const metadata = this.connection.getMetadata(
        entityTarget as EntityTarget<ObjectLiteral>
      );

      return this.expressionMap.createAlias({
        type: 'from',
        name: aliasName,
        metadata: this.connection.getMetadata(
          entityTarget as EntityTarget<ObjectLiteral>
        ),
        tablePath: metadata.tablePath,
      });
    } else {
      if (typeof entityTarget === 'string') {
        const isSubquery =
          entityTarget.substr(0, 1) === '(' && entityTarget.substr(-1) === ')';

        return this.expressionMap.createAlias({
          type: 'from',
          name: aliasName,
          tablePath: !isSubquery ? (entityTarget as string) : undefined,
          subQuery: isSubquery ? entityTarget : undefined,
        });
      }

      const subQueryBuilder: SelectQueryBuilder<ObjectLiteral> = (
        entityTarget as TFunction
      )(
        (this as unknown as SelectQueryBuilder<ObjectLiteral>).subQuery()
      ) as SelectQueryBuilder<ObjectLiteral>;
      this.setParameters(subQueryBuilder.getParameters());
      const subquery = subQueryBuilder.getQuery();

      return this.expressionMap.createAlias({
        type: 'from',
        name: aliasName,
        subQuery: subquery,
      });
    }
  }

  /**
   * Replaces all entity's propertyName to name in the given SQL string.
   */
  protected replacePropertyNamesForTheWholeQuery(statement: string): string {
    const replacements: Record<string, Record<string, string>> = {};

    for (const alias of this.expressionMap.aliases) {
      if (!alias.hasMetadata) continue;
      const replaceAliasNamePrefix =
        this.expressionMap.aliasNamePrefixingEnabled && alias.name
          ? `${alias.name}.`
          : '';

      if (!replacements[replaceAliasNamePrefix]) {
        replacements[replaceAliasNamePrefix] = {};
      }

      // Insert & overwrite the replacements from least to most relevant in our replacements object.
      // To do this we iterate and overwrite in the order of relevance.
      // Least to Most Relevant:
      // * Relation Property Path to first join column key
      // * Relation Property Path + Column Path
      // * Column Database Name
      // * Column Property Name
      // * Column Property Path

      for (const relation of alias.metadata.relations) {
        if (relation.joinColumns.length > 0)
          replacements[replaceAliasNamePrefix][relation.propertyPath] =
            relation.joinColumns[0]!.databaseName;
      }

      for (const relation of alias.metadata.relations) {
        const allColumns = [
          ...relation.joinColumns,
          ...relation.inverseJoinColumns,
        ];
        for (const joinColumn of allColumns) {
          const propertyKey = `${relation.propertyPath}.${
            joinColumn.referencedColumn!.propertyPath
          }`;
          replacements[replaceAliasNamePrefix][propertyKey] =
            joinColumn.databaseName;
        }
      }

      for (const column of alias.metadata.columns) {
        replacements[replaceAliasNamePrefix][column.databaseName] =
          column.databaseName;
      }

      for (const column of alias.metadata.columns) {
        replacements[replaceAliasNamePrefix][column.propertyName] =
          column.databaseName;
      }

      for (const column of alias.metadata.columns) {
        replacements[replaceAliasNamePrefix][column.propertyPath] =
          column.databaseName;
      }
    }

    const replacementKeys = Object.keys(replacements);
    const replaceAliasNamePrefixes = replacementKeys
      .map((key) => escapeRegExp(key))
      .join('|');

    if (replacementKeys.length > 0) {
      statement = statement.replace(
        new RegExp(
          // Avoid a lookbehind here since it's not well supported
          `([ =(]|^.{0})` + // any of ' =(' or start of line
            // followed by our prefix, e.g. 'tablename.' or ''
            `${
              replaceAliasNamePrefixes
                ? '(' + replaceAliasNamePrefixes + ')'
                : ''
            }([^ =(),]+)` + // a possible property name: sequence of anything but ' =(),'
            // terminated by ' =),' or end of line
            `(?=[ =),]|.{0}$)`,
          'gm'
        ),
        (...matches) => {
          let match: string, pre: string, p: string;
          if (replaceAliasNamePrefixes) {
            match = matches[0];
            pre = matches[1] as string;
            p = matches[3] as string;
            // const strategysFind = [(item: string |)]
            const findPropertyInAnotherCases = this.findPropertyInAnotherCases(
              p,
              replacements[matches[2] as string]
            );
            if (findPropertyInAnotherCases) {
              return `${pre}${this.escape(
                (matches[2] as string).substring(
                  0,
                  (matches[2] as string).length - 1
                ),
                true
              )}.${this.escape(findPropertyInAnotherCases as string)}`;
            }
          } else {
            match = matches[0];
            pre = matches[1] as string;
            p = matches[2] as string;

            if (replacements['']?.[p]) {
              return `${pre}${this.escape(replacements['']?.[p] as string)}`;
            }
          }
          return match;
        }
      );
    }

    return statement;
  }

  private findPropertyInAnotherCases(
    propertyName: string | undefined,
    findObject: Record<string, string | undefined> | undefined
  ): string | undefined {
    if (!propertyName || !findObject) return undefined;
    const propertyCasesArray = [
      propertyName,
      StringUtilities.toLowerCase(propertyName),
      propertyName.toUpperCase(),
      StringUtilities.toCamelCase(propertyName),
    ];
    propertyCasesArray.forEach((propertyCase) => {
      if (findObject[propertyCase]) {
        propertyName = propertyCase;
      }
    });
    return propertyName;
  }

  protected createComment(): string {
    if (!this.expressionMap.comment) {
      return '';
    }

    // ANSI SQL 2003 support C style comments - comments that start with `/*` and end with `*/`
    // In some dialects query nesting is available - but not all.  Because of this, we'll need
    // to scrub "ending" characters from the SQL but otherwise we can leave everything else
    // as-is and it should be valid.

    return `/* ${this.expressionMap.comment.replace(/\*\//g, '')} */ `;
  }

  /**
   * Time travel queries for CockroachDB
   */
  protected createTimeTravelQuery(): string {
    if (
      this.expressionMap.queryType === 'select' &&
      this.expressionMap.timeTravel
    ) {
      return ` AS OF SYSTEM TIME ${this.expressionMap.timeTravel}`;
    }

    return '';
  }

  /**
   * Creates "WHERE" expression.
   */
  protected createWhereExpression(): string {
    const conditionsArray = [];

    const whereExpression = this.createWhereClausesExpression(
      this.expressionMap.wheres
    );

    if (whereExpression.length > 0 && whereExpression !== '1=1') {
      conditionsArray.push(whereExpression);
    }

    if (this.expressionMap.mainAlias!.hasMetadata) {
      const metadata = this.expressionMap.mainAlias!.metadata;
      // Adds the global condition of "non-deleted" for the entity with delete date columns in select query.
      if (
        this.expressionMap.queryType === 'select' &&
        !this.expressionMap.withDeleted &&
        metadata.deleteDateColumn
      ) {
        const column = this.expressionMap.aliasNamePrefixingEnabled
          ? this.expressionMap.mainAlias!.name +
            '.' +
            metadata.deleteDateColumn.propertyName
          : metadata.deleteDateColumn.propertyName;

        const condition = `${column} IS NULL`;
        conditionsArray.push(condition);
      }

      if (metadata.discriminatorColumn && metadata.parentEntityMetadata) {
        const column = this.expressionMap.aliasNamePrefixingEnabled
          ? this.expressionMap.mainAlias!.name +
            '.' +
            metadata.discriminatorColumn.databaseName
          : metadata.discriminatorColumn.databaseName;

        const condition = `${column} IN (:...discriminatorColumnValues)`;
        conditionsArray.push(condition);
      }
    }

    if (this.expressionMap.extraAppendedAndWhereCondition) {
      const condition = this.expressionMap.extraAppendedAndWhereCondition;

      conditionsArray.push(condition);
    }

    let condition = '';

    // time travel
    condition += this.createTimeTravelQuery();

    if (!conditionsArray.length) {
      condition += '';
    } else if (conditionsArray.length === 1) {
      condition += ` WHERE ${conditionsArray[0]}`;
    } else {
      condition += ` WHERE ( ${conditionsArray.join(' ) AND ( ')} )`;
    }

    return condition;
  }

  /**
   * Creates "RETURNING" / "OUTPUT" expression.
   */
  protected createReturningExpression(returningType: ReturningType): string {
    const columns = this.getReturningColumns();
    const driver = this.connection.driver;

    // also add columns we must auto-return to perform entity updation
    // if user gave his own returning
    if (
      typeof this.expressionMap.returning !== 'string' &&
      this.expressionMap.extraReturningColumns.length > 0 &&
      driver.isReturningSqlSupported(returningType)
    ) {
      columns.push(
        ...this.expressionMap.extraReturningColumns.filter((column) => {
          return columns.indexOf(column) === -1;
        })
      );
    }

    if (columns.length) {
      let columnsExpression = columns
        .map((column) => {
          const name = this.escape(column.databaseName);
          return name;
        })
        .join(', ');

      if (driver.options.type === 'oracle') {
        columnsExpression +=
          ' INTO ' +
          columns
            .map((column) => {
              return this.createParameter({
                type: (driver as OracleDriver).columnTypeToNativeParameter(
                  column.type
                ),
                dir: (driver as OracleDriver).oracle.BIND_OUT,
              });
            })
            .join(', ');
      }

      return columnsExpression;
    } else if (typeof this.expressionMap.returning === 'string') {
      return this.expressionMap.returning;
    }

    return '';
  }

  /**
   * If returning / output cause is set to array of column names,
   * then this method will return all column metadatas of those column names.
   */
  protected getReturningColumns(): Array<ColumnMetadata> {
    const columns: Array<ColumnMetadata> = [];
    if (Array.isArray(this.expressionMap.returning)) {
      (this.expressionMap.returning as Array<string>).forEach((columnName) => {
        if (this.expressionMap.mainAlias!.hasMetadata) {
          columns.push(
            ...this.expressionMap.mainAlias!.metadata.findColumnsWithPropertyPath(
              columnName
            )
          );
        }
      });
    }
    return columns;
  }

  protected createWhereClausesExpression(clauses: Array<WhereClause>): string {
    return clauses
      .map((clause, index) => {
        const expression = this.createWhereConditionExpression(
          clause.condition
        );

        switch (clause.type) {
          case 'and':
            return (
              (index > 0 ? 'AND ' : '') +
              `${
                this.connection.options.isolateWhereStatements ? '(' : ''
              }${expression}${
                this.connection.options.isolateWhereStatements ? ')' : ''
              }`
            );
          case 'or':
            return (
              (index > 0 ? 'OR ' : '') +
              `${
                this.connection.options.isolateWhereStatements ? '(' : ''
              }${expression}${
                this.connection.options.isolateWhereStatements ? ')' : ''
              }`
            );
        }

        return expression;
      })
      .join(' ')
      .trim();
  }

  /**
   * Computes given where argument - transforms to a where string all forms it can take.
   */
  protected createWhereConditionExpression(
    condition: WhereClauseCondition,
    alwaysWrap = false
  ): string {
    if (typeof condition === 'string') return condition;

    if (Array.isArray(condition)) {
      if (condition.length === 0) {
        return '1=1';
      }

      // In the future we should probably remove this entire condition
      // but for now to prevent any breaking changes it exists.
      if (condition.length === 1 && !alwaysWrap) {
        return this.createWhereClausesExpression(condition);
      }

      return '(' + this.createWhereClausesExpression(condition) + ')';
    }

    const { driver } = this.connection;

    switch (condition.operator) {
      case 'lessThan':
        return `${condition.parameters[0]} < ${condition.parameters[1]}`;
      case 'lessThanOrEqual':
        return `${condition.parameters[0]} <= ${condition.parameters[1]}`;
      case 'arrayContains':
        return `${condition.parameters[0]} @> ${condition.parameters[1]}`;
      case 'jsonContains':
        return `${condition.parameters[0]} ::jsonb @> ${condition.parameters[1]}`;
      case 'arrayContainedBy':
        return `${condition.parameters[0]} <@ ${condition.parameters[1]}`;
      case 'arrayOverlap':
        return `${condition.parameters[0]} && ${condition.parameters[1]}`;
      case 'moreThan':
        return `${condition.parameters[0]} > ${condition.parameters[1]}`;
      case 'moreThanOrEqual':
        return `${condition.parameters[0]} >= ${condition.parameters[1]}`;
      case 'notEqual':
        return `${condition.parameters[0]} != ${condition.parameters[1]}`;
      case 'equal':
        return `${condition.parameters[0]} = ${condition.parameters[1]}`;
      case 'ilike':
        if (driver.options.type === 'postgres') {
          return `${condition.parameters[0]} ILIKE ${condition.parameters[1]}`;
        }

        return `UPPER(${condition.parameters[0]}) LIKE UPPER(${condition.parameters[1]})`;
      case 'like':
        return `${condition.parameters[0]} LIKE ${condition.parameters[1]}`;
      case 'between':
        return `${condition.parameters[0]} BETWEEN ${condition.parameters[1]} AND ${condition.parameters[2]}`;
      case 'in':
        if (condition.parameters.length <= 1) {
          return '0=1';
        }
        return `${condition.parameters[0]} IN (${condition.parameters
          .slice(1)
          .join(', ')})`;
      case 'any':
        return `${condition.parameters[0]} = ANY(${condition.parameters[1]})`;
      case 'isNull':
        return `${condition.parameters[0]} IS NULL`;

      case 'not':
        return `NOT(${this.createWhereConditionExpression(
          condition.condition
        )})`;
      case 'brackets':
        return `${this.createWhereConditionExpression(
          condition.condition,
          true
        )}`;
      case 'and':
        return '(' + condition.parameters.join(' AND ') + ')';
      case 'or':
        return '(' + condition.parameters.join(' OR ') + ')';
    }
  }

  protected createCteExpression(): string {
    if (!this.hasCommonTableExpressions()) {
      return '';
    }
    const databaseRequireRecusiveHint =
      this.driver.cteCapabilities.requiresRecursiveHint;

    const cteStrings = this.expressionMap.commonTableExpressions.map((cte) => {
      let cteBodyExpression =
        typeof cte.queryBuilder === 'string' ? cte.queryBuilder : '';
      if (typeof cte.queryBuilder !== 'string') {
        if (cte.queryBuilder.hasCommonTableExpressions()) {
          throw new TypeORMError(
            `Nested CTEs aren't supported (CTE: ${cte.alias})`
          );
        }
        cteBodyExpression = cte.queryBuilder.getQuery();
        if (
          !this.driver.cteCapabilities.writable &&
          !InstanceChecker.isSelectQueryBuilder(cte.queryBuilder)
        ) {
          throw new TypeORMError(
            `Only select queries are supported in CTEs in ${this.connection.options.type} (CTE: ${cte.alias})`
          );
        }
        this.setParameters(cte.queryBuilder.getParameters());
      }
      let cteHeader = this.escape(cte.alias);
      if (cte.options.columnNames) {
        const escapedColumnNames = cte.options.columnNames.map((column) =>
          this.escape(column)
        );
        if (InstanceChecker.isSelectQueryBuilder(cte.queryBuilder)) {
          if (
            cte.queryBuilder.expressionMap.selects.length &&
            cte.options.columnNames.length !==
              cte.queryBuilder.expressionMap.selects.length
          ) {
            throw new TypeORMError(
              `cte.options.columnNames length (${cte.options.columnNames.length}) doesn't match subquery select list length ${cte.queryBuilder.expressionMap.selects.length} (CTE: ${cte.alias})`
            );
          }
        }
        cteHeader += `(${escapedColumnNames.join(', ')})`;
      }
      const recursiveClause =
        cte.options.recursive && databaseRequireRecusiveHint ? 'RECURSIVE' : '';
      let materializeClause = '';
      if (
        this.driver.cteCapabilities.materializedHint &&
        cte.options.materialized !== undefined
      ) {
        materializeClause = cte.options.materialized
          ? 'MATERIALIZED'
          : 'NOT MATERIALIZED';
      }

      return [
        recursiveClause,
        cteHeader,
        'AS',
        materializeClause,
        `(${cteBodyExpression})`,
      ]
        .filter(Boolean)
        .join(' ');
    });

    return 'WITH ' + cteStrings.join(', ') + ' ';
  }

  /**
   * Creates "WHERE" condition for an in-ids condition.
   */
  protected getWhereInIdsCondition(
    ids: unknown | Array<unknown>
  ): ObjectLiteral | Brackets {
    const metadata = this.expressionMap.mainAlias!.metadata;
    const normalized = (Array.isArray(ids) ? ids : [ids]).map((id) =>
      metadata.ensureEntityIdMap(id)
    );

    // using in(...ids) for single primary key entities
    if (!metadata.hasMultiplePrimaryKeys) {
      const primaryColumn = metadata.primaryColumns[0];

      // getEntityValue will try to transform `In`, it is a bug
      // todo: remove this transformer check after #2390 is fixed
      // This also fails for embedded & relation, so until that is fixed skip it.
      if (
        !primaryColumn?.transformer &&
        !primaryColumn?.relationMetadata &&
        !primaryColumn?.embeddedMetadata
      ) {
        return {
          [primaryColumn?.propertyName as string]: In(
            normalized.map((id) => primaryColumn?.getEntityValue(id, false))
          ),
        };
      }
    }

    return new Brackets((qb) => {
      for (const data of normalized) {
        qb.orWhere(new Brackets((qb) => qb.where(data)));
      }
    });
  }

  protected getExistsCondition(
    subQuery: SelectQueryBuilder<ObjectLiteral>
  ): Array<ObjectLiteral> {
    const query = (subQuery.clone() as SelectQueryBuilder<ObjectLiteral>)
      .orderBy()
      .groupBy()
      .offset(undefined)
      .limit(undefined)
      .skip(undefined)
      .take(undefined)
      .select('1')
      .setOption('disable-global-order');

    return [
      `EXISTS (${query.getQuery()})`,
      query.getParameters(),
    ] as Array<ObjectLiteral>;
  }

  private findColumnsForPropertyPath(
    propertyPath: string
  ): [Alias, Array<string>, Array<ColumnMetadata>] {
    // Make a helper to iterate the entity & relations?
    // Use that to set the correct alias?  Or the other way around?

    // Start with the main alias with our property paths
    let alias = this.expressionMap.mainAlias;
    const root: Array<string> = [];
    const propertyPathParts = propertyPath.split('.');

    while (propertyPathParts.length > 1) {
      const part = propertyPathParts[0]!;

      if (!alias?.hasMetadata) {
        // If there's no metadata, we're wasting our time
        // and can't actually look any of this up.
        break;
      }

      if (alias.metadata.hasEmbeddedWithPropertyPath(part)) {
        // If this is an embedded then we should combine the two as part of our lookup.
        // Instead of just breaking, we keep going with this in case there's an embedded/relation
        // inside an embedded.
        propertyPathParts.unshift(
          `${propertyPathParts.shift()}.${propertyPathParts.shift()}`
        );
        continue;
      }

      if (alias.metadata.hasRelationWithPropertyPath(part)) {
        // If this is a relation then we should find the aliases
        // that match the relation & then continue further down
        // the property path
        const joinAttr = this.expressionMap.joinAttributes.find(
          (joinAttr) => joinAttr.relationPropertyPath === part
        );

        if (!joinAttr?.alias) {
          const fullRelationPath =
            root.length > 0 ? `${root.join('.')}.${part}` : part;
          throw new Error(
            `Cannot find alias for relation at ${fullRelationPath}`
          );
        }

        alias = joinAttr.alias;
        root.push(...part.split('.'));
        propertyPathParts.shift();
        continue;
      }

      break;
    }

    if (!alias) {
      throw new Error(`Cannot find alias for property ${propertyPath}`);
    }

    // Remaining parts are combined back and used to find the actual property path
    const aliasPropertyPath = propertyPathParts.join('.');

    const columns =
      alias.metadata.findColumnsWithPropertyPath(aliasPropertyPath);

    if (!columns.length) {
      throw new EntityPropertyNotFoundError(propertyPath, alias.metadata);
    }

    return [alias, root, columns];
  }

  /**
   * Creates a property paths for a given ObjectLiteral.
   */
  protected createPropertyPath(
    metadata: EntityMetadata,
    entity: ObjectLiteral,
    prefix = ''
  ): Array<string> {
    const paths: Array<string> = [];

    for (const key of Object.keys(entity)) {
      const path = prefix ? `${prefix}.${key}` : key;

      // There's times where we don't actually want to traverse deeper.
      // If the value is a `FindOperator`, or null, or not an object, then we don't, for example.
      if (
        entity[key] === null ||
        typeof entity[key] !== 'object' ||
        InstanceChecker.isFindOperator(entity[key])
      ) {
        paths.push(path);
        continue;
      }

      if (metadata.hasEmbeddedWithPropertyPath(path)) {
        const subPaths = this.createPropertyPath(
          metadata,
          entity[key] as ObjectLiteral,
          path
        );
        paths.push(...subPaths);
        continue;
      }

      if (metadata.hasRelationWithPropertyPath(path)) {
        const relation = metadata.findRelationWithPropertyPath(path)!;

        // There's also cases where we don't want to return back all of the properties.
        // These handles the situation where someone passes the model & we don't need to make
        // a HUGE `where` to uniquely look up the entity.

        // In the case of a *-to-one, there's only ever one possible entity on the other side
        // so if the join columns are all defined we can return just the relation itself
        // because it will fetch only the join columns and do the lookup.
        if (
          relation.relationType === 'one-to-one' ||
          relation.relationType === 'many-to-one'
        ) {
          const joinColumns = relation.joinColumns
            .map((j) => j.referencedColumn)
            .filter((j): j is ColumnMetadata => !!j);

          const hasAllJoinColumns =
            joinColumns.length > 0 &&
            joinColumns.every((column) =>
              column.getEntityValue(entity[key] as ObjectLiteral, false)
            );

          if (hasAllJoinColumns) {
            paths.push(path);
            continue;
          }
        }

        if (
          relation.relationType === 'one-to-many' ||
          relation.relationType === 'many-to-many'
        ) {
          throw new Error(
            `Cannot query across ${relation.relationType} for property ${path}`
          );
        }

        // For any other case, if the `entity[key]` contains all of the primary keys we can do a
        // lookup via these.  We don't need to look up via any other values 'cause these are
        // the unique primary keys.
        // This handles the situation where someone passes the model & we don't need to make
        // a HUGE where.
        const primaryColumns = relation.inverseEntityMetadata.primaryColumns;
        const hasAllPrimaryKeys =
          primaryColumns.length > 0 &&
          primaryColumns.every((column) =>
            column.getEntityValue(entity[key] as ObjectLiteral, false)
          );

        if (hasAllPrimaryKeys) {
          const subPaths = primaryColumns.map(
            (column) => `${path}.${column.propertyPath}`
          );
          paths.push(...subPaths);
          continue;
        }

        // If nothing else, just return every property that's being passed to us.
        const subPaths = this.createPropertyPath(
          relation.inverseEntityMetadata,
          entity[key] as ObjectLiteral
        ).map((p) => `${path}.${p}`);
        paths.push(...subPaths);
        continue;
      }

      paths.push(path);
    }

    return paths;
  }

  protected *getPredicates(
    where: ObjectLiteral
  ): Generator<Array<unknown>, void, unknown> {
    if (this.expressionMap.mainAlias!.hasMetadata) {
      const propertyPaths = this.createPropertyPath(
        this.expressionMap.mainAlias!.metadata,
        where
      );

      for (const propertyPath of propertyPaths) {
        const [alias, aliasPropertyPath, columns] =
          this.findColumnsForPropertyPath(propertyPath);

        for (const column of columns) {
          let containedWhere = where;

          for (const part of aliasPropertyPath) {
            if (!containedWhere || !(part in containedWhere)) {
              containedWhere = {};
              break;
            }

            containedWhere = containedWhere[part] as ObjectLiteral;
          }

          // Use the correct alias & the property path from the column
          const aliasPath = this.expressionMap.aliasNamePrefixingEnabled
            ? `${alias.name}.${column.propertyPath}`
            : column.propertyPath;

          const parameterValue = column.getEntityValue(containedWhere, true);

          yield [aliasPath, parameterValue];
        }
      }
    } else {
      for (const key of Object.keys(where)) {
        const parameterValue = where[key];
        const aliasPath = this.expressionMap.aliasNamePrefixingEnabled
          ? `${this.alias}.${key}`
          : key;

        yield [aliasPath, parameterValue];
      }
    }
  }

  protected getWherePredicateCondition(
    aliasPath: string,
    parameterValue: FindOperator<ObjectLiteral>
  ): WhereClauseCondition {
    if (InstanceChecker.isFindOperator(parameterValue)) {
      const parameters: Array<string> = [];
      if (parameterValue.useParameter) {
        if (parameterValue.objectLiteralParameters) {
          this.setParameters(parameterValue.objectLiteralParameters);
        } else if (parameterValue.multipleParameters) {
          for (const v of parameterValue.value as unknown as Array<
            FindOperator<ObjectLiteral>
          >) {
            parameters.push(this.createParameter(v));
          }
        } else {
          parameters.push(this.createParameter(parameterValue.value));
        }
      }

      if (parameterValue.type === 'raw') {
        if (parameterValue.getSql) {
          return parameterValue.getSql(aliasPath);
        } else {
          return {
            operator: 'equal',
            parameters: [aliasPath, parameterValue.value as unknown as string],
          };
        }
      } else if (parameterValue.type === 'not') {
        if (parameterValue.child) {
          return {
            operator: parameterValue.type,
            condition: this.getWherePredicateCondition(
              aliasPath,
              parameterValue.child
            ),
          };
        } else {
          return {
            operator: 'notEqual',
            parameters: [aliasPath, ...parameters],
          };
        }
      } else if (parameterValue.type === 'and') {
        const values: Array<FindOperator<ObjectLiteral>> =
          parameterValue.value as unknown as Array<FindOperator<ObjectLiteral>>;

        return {
          operator: parameterValue.type,
          parameters: values.map((operator) =>
            this.createWhereConditionExpression(
              this.getWherePredicateCondition(aliasPath, operator)
            )
          ),
        };
      } else if (parameterValue.type === 'or') {
        const values: Array<FindOperator<ObjectLiteral>> =
          parameterValue.value as unknown as Array<FindOperator<ObjectLiteral>>;

        return {
          operator: parameterValue.type,
          parameters: values.map((operator) =>
            this.createWhereConditionExpression(
              this.getWherePredicateCondition(aliasPath, operator)
            )
          ),
        };
      } else {
        return {
          operator: parameterValue.type,
          parameters: [aliasPath, ...parameters],
        };
      }
    } else if (parameterValue === null) {
      const nullBehavior =
        this.connection.options.invalidWhereValuesBehavior?.null || 'ignore';
      if (nullBehavior === 'sql-null') {
        return {
          operator: 'isNull',
          parameters: [aliasPath],
        };
      } else if (nullBehavior === 'throw') {
        throw new TypeORMError(
          `Null value encountered in property '${aliasPath}' of a where condition. ` +
            `To match with SQL NULL, the IsNull() operator must be used. ` +
            `Set 'invalidWhereValuesBehavior.null' to 'ignore' or 'sql-null' in connection options to skip or handle null values.`
        );
      }
    } else if (parameterValue === undefined) {
      const undefinedBehavior =
        this.connection.options.invalidWhereValuesBehavior?.undefined ||
        'ignore';
      if (undefinedBehavior === 'throw') {
        throw new TypeORMError(
          `Undefined value encountered in property '${aliasPath}' of a where condition. ` +
            `Set 'invalidWhereValuesBehavior.undefined' to 'ignore' in connection options to skip properties with undefined values.`
        );
      }
    }

    return {
      operator: 'equal',
      parameters: [aliasPath, this.createParameter(parameterValue)],
    };
  }

  protected getWhereCondition(
    where:
      | string
      | ((qb: this) => string)
      | Brackets
      | NotBrackets
      | ObjectLiteral
      | Array<ObjectLiteral>
  ): WhereClauseCondition {
    if (typeof where === 'string') {
      return where;
    }

    if (InstanceChecker.isBrackets(where)) {
      const whereQueryBuilder =
        this.createQueryBuilder<QueryBuilder<ObjectLiteral>>();

      whereQueryBuilder.parentQueryBuilder =
        this as QueryBuilder<ObjectLiteral>;

      whereQueryBuilder.expressionMap.mainAlias = this.expressionMap.mainAlias;
      whereQueryBuilder.expressionMap.aliasNamePrefixingEnabled =
        this.expressionMap.aliasNamePrefixingEnabled;
      whereQueryBuilder.expressionMap.parameters =
        this.expressionMap.parameters;
      whereQueryBuilder.expressionMap.nativeParameters =
        this.expressionMap.nativeParameters;

      whereQueryBuilder.expressionMap.wheres = [];

      where.whereFactory(
        whereQueryBuilder as unknown as WhereExpressionBuilder
      );

      return {
        operator: InstanceChecker.isNotBrackets(where) ? 'not' : 'brackets',
        condition: whereQueryBuilder.expressionMap.wheres,
      };
    }

    if (typeof where === 'function') {
      return where(this);
    }

    const wheres: Array<ObjectLiteral | NotBrackets> = Array.isArray(where)
      ? where
      : [where];
    const clauses: Array<WhereClause> = [];

    for (const where of wheres) {
      const conditions: WhereClauseCondition = [];

      // Filter the conditions and set up the parameter values
      for (const [aliasPath, parameterValue] of this.getPredicates(
        where as ObjectLiteral
      )) {
        conditions.push({
          type: 'and',
          condition: this.getWherePredicateCondition(
            aliasPath as string,
            parameterValue as FindOperator<ObjectLiteral>
          ),
        });
      }

      clauses.push({ type: 'or', condition: conditions });
    }

    if (clauses.length === 1) {
      return clauses[0]!.condition;
    }

    return clauses;
  }

  /**
   * Creates a query builder used to execute sql queries inside this query builder.
   */
  protected obtainQueryRunner(): QueryRunner {
    return this.queryRunner ?? this.connection.createQueryRunner();
  }

  protected hasCommonTableExpressions(): boolean {
    return this.expressionMap.commonTableExpressions.length > 0;
  }
}
