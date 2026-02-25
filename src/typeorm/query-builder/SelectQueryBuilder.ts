import type { TFunction } from '../../types/utility.types.js';
import type { QueryResultCacheOptions } from '../cache/cache.types.js';
import type { EntityTarget } from '../common/EntityTarget.js';
import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { DataSource } from '../data-source/DataSource.js';
import { DriverUtils } from '../driver/DriverUtils.js';
import { EntityNotFoundError } from '../error/EntityNotFoundError.js';
import { EntityPropertyNotFoundError } from '../error/EntityPropertyNotFoundError.js';
import { LockNotSupportedOnGivenDriverError } from '../error/LockNotSupportedOnGivenDriverError.js';
import { NoVersionOrUpdateDateColumnError } from '../error/NoVersionOrUpdateDateColumnError.js';
import { OptimisticLockCanNotBeUsedError } from '../error/OptimisticLockCanNotBeUsedError.js';
import { OptimisticLockVersionMismatchError } from '../error/OptimisticLockVersionMismatchError.js';
import { PessimisticLockTransactionRequiredError } from '../error/PessimisticLockTransactionRequiredError.js';
import { TypeORMError } from '../error/TypeORMError.js';
import type { FindManyOptions } from '../find-options/FindManyOptions.js';
import { FindOperator } from '../find-options/FindOperator.js';
import type {
  FindOptionsOrder,
  FindOptionsOrderValue,
} from '../find-options/FindOptionsOrder.js';
import type { FindOptionsRelations } from '../find-options/FindOptionsRelations.js';
import type { FindOptionsSelect } from '../find-options/FindOptionsSelect.js';
import { FindOptionsUtils } from '../find-options/FindOptionsUtils.js';
import type { FindOptionsWhere } from '../find-options/FindOptionsWhere.js';
import type { OrderByCondition } from '../find-options/OrderByCondition.js';
import { ColumnMetadata } from '../metadata/ColumnMetadata.js';
import { EntityMetadata } from '../metadata/EntityMetadata.js';
import { RelationMetadata } from '../metadata/RelationMetadata.js';
import { ReadStream } from '../platform/PlatformTools.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
import { ApplyValueTransformers } from '../util/ApplyValueTransformers.js';
import { InstanceChecker } from '../util/InstanceChecker.js';
import { ObjectUtils } from '../util/ObjectUtils.js';
import { OrmUtils } from '../util/OrmUtils.js';

import { Brackets } from './Brackets.js';
import { JoinAttribute } from './JoinAttribute.js';
import { QueryBuilder } from './QueryBuilder.js';
import { QueryExpressionMap } from './QueryExpressionMap.js';
import { RelationCountAttribute } from './relation-count/RelationCountAttribute.js';
import { RelationCountLoader } from './relation-count/RelationCountLoader.js';
import { RelationCountMetadataToAttributeTransformer } from './relation-count/RelationCountMetadataToAttributeTransformer.js';
import { RelationIdAttribute } from './relation-id/RelationIdAttribute.js';
import { RelationIdLoader } from './relation-id/RelationIdLoader.js';
import { RelationIdMetadataToAttributeTransformer } from './relation-id/RelationIdMetadataToAttributeTransformer.js';
import { RelationIdLoader as QueryStrategyRelationIdLoader } from './RelationIdLoader.js';
import type { SelectQuery } from './SelectQuery.js';
import type { SelectQueryBuilderOption } from './SelectQueryBuilderOption.js';
import { RawSqlResultsToEntityTransformer } from './transformer/RawSqlResultsToEntityTransformer.js';
import type { WhereExpressionBuilder } from './WhereExpressionBuilder.js';

/**
 * Allows to build complex sql queries in a fashion way and execute those queries.
 */
export class SelectQueryBuilder<Entity extends ObjectLiteral>
  extends QueryBuilder<Entity>
  implements WhereExpressionBuilder
{
  public readonly '@instanceof' = Symbol.for('SelectQueryBuilder');

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    connectionOrQueryBuilder: DataSource | QueryBuilder<Entity>,
    queryRunner?: QueryRunner
  ) {
    super(connectionOrQueryBuilder as DataSource, queryRunner);
  }

  protected findOptions: FindManyOptions = {};
  protected selects: Array<string> = [];
  protected joins: Array<{
    type: 'inner' | 'left';
    alias: string;
    parentAlias: string;
    relationMetadata: RelationMetadata;
    select: boolean;
    selection: FindOptionsSelect<unknown> | undefined;
  }> = [];
  protected conditions = '';
  protected orderBys: Array<{
    alias: string;
    direction: 'ASC' | 'DESC';
    nulls?: 'NULLS FIRST' | 'NULLS LAST';
  }> = [];
  protected relationMetadatas: Array<RelationMetadata> = [];

  // -------------------------------------------------------------------------
  // Public Implemented Methods
  // -------------------------------------------------------------------------

  /**
   * Gets generated SQL query without parameters being replaced.
   */
  public getQuery(): string {
    let sql = this.createComment();
    sql += this.createCteExpression();
    sql += this.createSelectExpression();
    sql += this.createJoinExpression();
    sql += this.createWhereExpression();
    sql += this.createGroupByExpression();
    sql += this.createHavingExpression();
    sql += this.createOrderByExpression();
    sql += this.createLimitOffsetExpression();
    sql += this.createLockExpression();
    sql = sql.trim();
    if (this.expressionMap.subQuery) sql = '(' + sql + ')';
    return this.replacePropertyNamesForTheWholeQuery(sql);
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  public setFindOptions(findOptions: FindManyOptions<Entity>): this {
    this.findOptions = findOptions;
    this.applyFindOptions();
    return this;
  }

  /**
   * Creates a subquery - query that can be used inside other queries.
   */
  public subQuery(): SelectQueryBuilder<ObjectLiteral> {
    const qb = this.createQueryBuilder<SelectQueryBuilder<ObjectLiteral>>();
    qb.expressionMap.subQuery = true;
    qb.parentQueryBuilder = this as unknown as QueryBuilder<ObjectLiteral>;
    return qb;
  }

  /**
   * Creates SELECT query.
   * Replaces all previous selections if they exist.
   */
  public select(): this;

  /**
   * Creates SELECT query.
   * Replaces all previous selections if they exist.
   */
  public select(
    selection: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    selectionAliasName?: string
  ): this;

  /**
   * Creates SELECT query and selects given data.
   * Replaces all previous selections if they exist.
   */
  public select(selection: string, selectionAliasName?: string): this;

  /**
   * Creates SELECT query and selects given data.
   * Replaces all previous selections if they exist.
   */
  public select(selection: Array<string>): this;

  /**
   * Creates SELECT query and selects given data.
   * Replaces all previous selections if they exist.
   */
  public select(
    selection?:
      | string
      | Array<string>
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    selectionAliasName?: string
  ): SelectQueryBuilder<Entity> {
    this.expressionMap.queryType = 'select';
    if (Array.isArray(selection)) {
      this.expressionMap.selects = selection.map((selection) => ({
        selection: selection,
      }));
    } else if (typeof selection === 'function') {
      const subQueryBuilder = selection(this.subQuery());
      this.setParameters(subQueryBuilder.getParameters());
      this.expressionMap.selects.push({
        selection: subQueryBuilder.getQuery(),
        aliasName: selectionAliasName,
      });
    } else if (selection) {
      this.expressionMap.selects = [
        { selection: selection, aliasName: selectionAliasName },
      ];
    }

    return this;
  }

  /**
   * Adds new selection to the SELECT query.
   */
  public addSelect(
    selection: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    selectionAliasName?: string
  ): this;

  /**
   * Adds new selection to the SELECT query.
   */
  public addSelect(selection: string, selectionAliasName?: string): this;

  /**
   * Adds new selection to the SELECT query.
   */
  public addSelect(selection: Array<string>): this;

  /**
   * Adds new selection to the SELECT query.
   */
  public addSelect(
    selection:
      | string
      | Array<string>
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    selectionAliasName?: string
  ): this {
    if (!selection) return this;

    if (Array.isArray(selection)) {
      this.expressionMap.selects = this.expressionMap.selects.concat(
        selection.map((selection) => ({ selection: selection }))
      );
    } else if (typeof selection === 'function') {
      const subQueryBuilder = selection(this.subQuery());
      this.setParameters(subQueryBuilder.getParameters());
      this.expressionMap.selects.push({
        selection: subQueryBuilder.getQuery(),
        aliasName: selectionAliasName,
      });
    } else if (selection) {
      this.expressionMap.selects.push({
        selection: selection,
        aliasName: selectionAliasName,
      });
    }

    return this;
  }

  /**
   * Set max execution time.
   * @param milliseconds
   */
  public maxExecutionTime(milliseconds: number): this {
    this.expressionMap.maxExecutionTime = milliseconds;
    return this;
  }

  /**
   * Sets whether the selection is DISTINCT.
   */
  public distinct(distinct = true): this {
    this.expressionMap.selectDistinct = distinct;
    return this;
  }

  /**
   * Sets the distinct on clause for Postgres.
   */
  public distinctOn(distinctOn: Array<string>): this {
    this.expressionMap.selectDistinctOn = distinctOn;
    return this;
  }

  public fromDummy(): SelectQueryBuilder<ObjectLiteral> {
    return this.from(
      this.driver.dummyTableName ?? '(SELECT 1 AS dummy_column)',
      'dummy_table'
    );
  }

  /**
   * Specifies FROM which entity's table select/update/delete will be executed.
   * Also sets a main string alias of the selection data.
   * Removes all previously set from-s.
   */
  public from<T extends ObjectLiteral>(
    entityTarget: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    aliasName: string
  ): SelectQueryBuilder<T>;

  /**
   * Specifies FROM which entity's table select/update/delete will be executed.
   * Also sets a main string alias of the selection data.
   * Removes all previously set from-s.
   */
  public from<T extends ObjectLiteral>(
    entityTarget: EntityTarget<T>,
    aliasName: string
  ): SelectQueryBuilder<T>;

  /**
   * Specifies FROM which entity's table select/update/delete will be executed.
   * Also sets a main string alias of the selection data.
   * Removes all previously set from-s.
   */
  public from<T extends ObjectLiteral>(
    entityTarget:
      | EntityTarget<T>
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    aliasName: string
  ): SelectQueryBuilder<T> {
    const mainAlias = this.createFromAlias(entityTarget, aliasName);
    this.expressionMap.setMainAlias(mainAlias);
    return this as unknown as SelectQueryBuilder<T>;
  }

  /**
   * Specifies FROM which entity's table select/update/delete will be executed.
   * Also sets a main string alias of the selection data.
   */
  public addFrom<T extends ObjectLiteral>(
    entityTarget: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    aliasName: string
  ): SelectQueryBuilder<T>;

  /**
   * Specifies FROM which entity's table select/update/delete will be executed.
   * Also sets a main string alias of the selection data.
   */
  public addFrom<T extends ObjectLiteral>(
    entityTarget: EntityTarget<T>,
    aliasName: string
  ): SelectQueryBuilder<T>;

  /**
   * Specifies FROM which entity's table select/update/delete will be executed.
   * Also sets a main string alias of the selection data.
   */
  public addFrom<T extends ObjectLiteral>(
    entityTarget:
      | EntityTarget<T>
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    aliasName: string
  ): SelectQueryBuilder<T> {
    const alias = this.createFromAlias(entityTarget, aliasName);
    if (!this.expressionMap.mainAlias) this.expressionMap.setMainAlias(alias);

    return this as unknown as SelectQueryBuilder<T>;
  }

  /**
   * INNER JOINs (without selection) given subquery.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoin(
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs (without selection) entity's property.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoin(
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs (without selection) given entity's table.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoin(
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs (without selection) given table.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoin(
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs (without selection).
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoin(
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this {
    this.join('INNER', entityOrProperty, alias, condition, parameters);
    return this;
  }

  /**
   * LEFT JOINs (without selection) given subquery.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoin(
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs (without selection) entity's property.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoin(
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs (without selection) entity's table.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoin(
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs (without selection) given table.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoin(
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs (without selection).
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoin(
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this {
    this.join('LEFT', entityOrProperty, alias, condition, parameters);
    return this;
  }

  /**
   * INNER JOINs given subquery and adds all selection properties to SELECT..
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndSelect(
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs entity's property and adds all selection properties to SELECT.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndSelect(
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs entity and adds all selection properties to SELECT.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndSelect(
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs table and adds all selection properties to SELECT.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndSelect(
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs and adds all selection properties to SELECT.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndSelect(
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this {
    this.addSelect(alias);
    this.innerJoin(
      entityOrProperty as (
        qb: SelectQueryBuilder<ObjectLiteral>
      ) => SelectQueryBuilder<ObjectLiteral>,
      alias,
      condition,
      parameters
    );
    return this;
  }

  /**
   * LEFT JOINs given subquery and adds all selection properties to SELECT..
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndSelect(
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs entity's property and adds all selection properties to SELECT.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndSelect(
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs entity and adds all selection properties to SELECT.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndSelect(
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs table and adds all selection properties to SELECT.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndSelect(
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs and adds all selection properties to SELECT.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndSelect(
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this {
    this.addSelect(alias);
    this.leftJoin(
      entityOrProperty as (
        qb: SelectQueryBuilder<ObjectLiteral>
      ) => SelectQueryBuilder<ObjectLiteral>,
      alias,
      condition,
      parameters
    );
    return this;
  }

  /**
   * INNER JOINs given subquery, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapMany(
    mapToProperty: string,
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs entity's property, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapMany(
    mapToProperty: string,
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs entity's table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapMany(
    mapToProperty: string,
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapMany(
    mapToProperty: string,
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapMany(
    mapToProperty: string,
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this {
    this.addSelect(alias);
    this.join(
      'INNER',
      entityOrProperty,
      alias,
      condition,
      parameters,
      mapToProperty,
      true
    );
    return this;
  }

  /**
   * INNER JOINs given subquery, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapOne(
    mapToProperty: string,
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral,
    mapAsEntity?: TFunction | string
  ): this;

  /**
   * INNER JOINs entity's property, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapOne(
    mapToProperty: string,
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs entity's table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapOne(
    mapToProperty: string,
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapOne(
    mapToProperty: string,
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * INNER JOINs, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public innerJoinAndMapOne(
    mapToProperty: string,
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral,
    mapAsEntity?: TFunction | string
  ): this {
    this.addSelect(alias);
    this.join(
      'INNER',
      entityOrProperty,
      alias,
      condition,
      parameters,
      mapToProperty,
      false,
      mapAsEntity
    );
    return this;
  }

  /**
   * LEFT JOINs given subquery, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapMany(
    mapToProperty: string,
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs entity's property, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapMany(
    mapToProperty: string,
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs entity's table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapMany(
    mapToProperty: string,
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapMany(
    mapToProperty: string,
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there are multiple rows of selecting data, and mapped result will be an array.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapMany(
    mapToProperty: string,
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this {
    this.addSelect(alias);
    this.join(
      'LEFT',
      entityOrProperty,
      alias,
      condition,
      parameters,
      mapToProperty,
      true
    );
    return this;
  }

  /**
   * LEFT JOINs given subquery, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapOne(
    mapToProperty: string,
    subQueryFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral,
    mapAsEntity?: TFunction | string
  ): this;

  /**
   * LEFT JOINs entity's property, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * Given entity property should be a relation.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapOne(
    mapToProperty: string,
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs entity's table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapOne(
    mapToProperty: string,
    entity: TFunction | string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs table, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapOne(
    mapToProperty: string,
    tableName: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral
  ): this;

  /**
   * LEFT JOINs, SELECTs the data returned by a join and MAPs all that data to some entity's property.
   * This is extremely useful when you want to select some data and map it to some virtual property.
   * It will assume that there is a single row of selecting data, and mapped result will be a single selected value.
   * You also need to specify an alias of the joined data.
   * Optionally, you can add condition and parameters used in condition.
   */
  public leftJoinAndMapOne(
    mapToProperty: string,
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral,
    mapAsEntity?: TFunction | string
  ): this {
    this.addSelect(alias);
    this.join(
      'LEFT',
      entityOrProperty,
      alias,
      condition,
      parameters,
      mapToProperty,
      false,
      mapAsEntity
    );
    return this;
  }

  /**
   */
  // selectAndMap(mapToProperty: string, property: string, aliasName: string, qbFactory: ((qb: SelectQueryBuilder<unknown>) => SelectQueryBuilder<unknown>)): this;

  /**
   */
  // selectAndMap(mapToProperty: string, entity: () => unknown|string, aliasName: string, qbFactory: ((qb: SelectQueryBuilder<unknown>) => SelectQueryBuilder<unknown>)): this;

  /**
   */
  // selectAndMap(mapToProperty: string, tableName: string, aliasName: string, qbFactory: ((qb: SelectQueryBuilder<unknown>) => SelectQueryBuilder<unknown>)): this;

  /**
   */
  // selectAndMap(mapToProperty: string, entityOrProperty: () => unknown|string, aliasName: string, qbFactory: ((qb: SelectQueryBuilder<unknown>) => SelectQueryBuilder<unknown>)): this {
  //     const select = new SelectAttribute(this.expressionMap);
  //     select.mapToProperty = mapToProperty;
  //     select.entityOrProperty = entityOrProperty;
  //     select.aliasName = aliasName;
  //     select.qbFactory = qbFactory;
  //     return this;
  // }

  /**
   * LEFT JOINs relation id and maps it into some entity's property.
   * Optionally, you can add condition and parameters used in condition.
   */
  public loadRelationIdAndMap(
    mapToProperty: string,
    relationName: string,
    options?: { disableMixedMap?: boolean }
  ): this;

  /**
   * LEFT JOINs relation id and maps it into some entity's property.
   * Optionally, you can add condition and parameters used in condition.
   */
  public loadRelationIdAndMap(
    mapToProperty: string,
    relationName: string,
    alias: string,
    queryBuilderFactory: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>
  ): this;

  /**
   * LEFT JOINs relation id and maps it into some entity's property.
   * Optionally, you can add condition and parameters used in condition.
   */
  public loadRelationIdAndMap(
    mapToProperty: string,
    relationName: string,
    aliasNameOrOptions?: string | { disableMixedMap?: boolean },
    queryBuilderFactory?: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>
  ): this {
    const relationIdAttribute = new RelationIdAttribute(this.expressionMap);
    relationIdAttribute.mapToProperty = mapToProperty;
    relationIdAttribute.relationName = relationName;
    if (typeof aliasNameOrOptions === 'string')
      relationIdAttribute.alias = aliasNameOrOptions;
    if (
      typeof aliasNameOrOptions === 'object' &&
      aliasNameOrOptions.disableMixedMap
    )
      relationIdAttribute.disableMixedMap = true;

    relationIdAttribute.queryBuilderFactory = queryBuilderFactory;
    this.expressionMap.relationIdAttributes.push(relationIdAttribute);

    if (relationIdAttribute.relation.junctionEntityMetadata) {
      this.expressionMap.createAlias({
        type: 'other',
        name: relationIdAttribute.junctionAlias,
        metadata: relationIdAttribute.relation.junctionEntityMetadata,
      });
    }
    return this;
  }

  /**
   * Counts number of entities of entity's relation and maps the value into some entity's property.
   * Optionally, you can add condition and parameters used in condition.
   */
  public loadRelationCountAndMap(
    mapToProperty: string,
    relationName: string,
    aliasName?: string,
    queryBuilderFactory?: (
      qb: SelectQueryBuilder<ObjectLiteral>
    ) => SelectQueryBuilder<ObjectLiteral>
  ): this {
    const relationCountAttribute = new RelationCountAttribute(
      this.expressionMap
    );
    relationCountAttribute.mapToProperty = mapToProperty;
    relationCountAttribute.relationName = relationName;
    relationCountAttribute.alias = aliasName;
    relationCountAttribute.queryBuilderFactory = queryBuilderFactory;
    this.expressionMap.relationCountAttributes.push(relationCountAttribute);

    this.expressionMap.createAlias({
      type: 'other',
      name: relationCountAttribute.junctionAlias,
    });
    if (relationCountAttribute.relation.junctionEntityMetadata) {
      this.expressionMap.createAlias({
        type: 'other',
        name: relationCountAttribute.junctionAlias,
        metadata: relationCountAttribute.relation.junctionEntityMetadata,
      });
    }
    return this;
  }

  /**
   * Loads all relation ids for all relations of the selected entity.
   * All relation ids will be mapped to relation property themself.
   * If array of strings is given then loads only relation ids of the given properties.
   */
  public loadAllRelationIds(options?: {
    relations?: Array<string>;
    disableMixedMap?: boolean;
  }): this {
    // todo: add skip relations
    this.expressionMap.mainAlias!.metadata.relations.forEach((relation) => {
      if (
        options !== undefined &&
        options.relations !== undefined &&
        options.relations.indexOf(relation.propertyPath) === -1
      )
        return;

      this.loadRelationIdAndMap(
        this.expressionMap.mainAlias!.name + '.' + relation.propertyPath,
        this.expressionMap.mainAlias!.name + '.' + relation.propertyPath,
        options
      );
    });
    return this;
  }

  /**
   * Sets WHERE condition in the query builder.
   * If you had previously WHERE expression defined,
   * calling this function will override previously set WHERE conditions.
   * Additionally you can add parameters used in where expression.
   */
  public where(
    where:
      | Brackets
      | string
      | ((qb: this) => string)
      | ObjectLiteral
      | Array<ObjectLiteral>,
    parameters?: ObjectLiteral
  ): this {
    this.expressionMap.wheres = []; // don't move this block below since computeWhereParameter can add where expressions
    const condition = this.getWhereCondition(where);
    if (condition) {
      this.expressionMap.wheres = [{ type: 'simple', condition: condition }];
    }
    if (parameters) this.setParameters(parameters);
    return this;
  }

  /**
   * Adds new AND WHERE condition in the query builder.
   * Additionally you can add parameters used in where expression.
   */
  public andWhere(
    where:
      | string
      | Brackets
      | ((qb: this) => string)
      | ObjectLiteral
      | Array<ObjectLiteral>,
    parameters?: ObjectLiteral
  ): this {
    this.expressionMap.wheres.push({
      type: 'and',
      condition: this.getWhereCondition(where),
    });
    if (parameters) this.setParameters(parameters);
    return this;
  }

  /**
   * Adds new OR WHERE condition in the query builder.
   * Additionally you can add parameters used in where expression.
   */
  public orWhere(
    where:
      | Brackets
      | string
      | ((qb: this) => string)
      | ObjectLiteral
      | Array<ObjectLiteral>,
    parameters?: ObjectLiteral
  ): this {
    this.expressionMap.wheres.push({
      type: 'or',
      condition: this.getWhereCondition(where),
    });
    if (parameters) this.setParameters(parameters);
    return this;
  }

  /**
   * Sets a new where EXISTS clause
   */
  public whereExists(subQuery: SelectQueryBuilder<ObjectLiteral>): this {
    return this.where(this.getExistsCondition(subQuery));
  }

  /**
   * Adds a new AND where EXISTS clause
   */
  public andWhereExists(subQuery: SelectQueryBuilder<ObjectLiteral>): this {
    return this.andWhere(this.getExistsCondition(subQuery));
  }

  /**
   * Adds a new OR where EXISTS clause
   */
  public orWhereExists(subQuery: SelectQueryBuilder<ObjectLiteral>): this {
    return this.orWhere(this.getExistsCondition(subQuery));
  }

  /**
   * Adds new AND WHERE with conditions for the given ids.
   *
   * Ids are mixed.
   * It means if you have single primary key you can pass a simple id values, for example [1, 2, 3].
   * If you have multiple primary keys you need to pass object with property names and values specified,
   * for example [{ firstId: 1, secondId: 2 }, { firstId: 2, secondId: 3 }, ...]
   */
  public whereInIds(ids: unknown | Array<unknown>): this {
    return this.where(this.getWhereInIdsCondition(ids));
  }

  /**
   * Adds new AND WHERE with conditions for the given ids.
   *
   * Ids are mixed.
   * It means if you have single primary key you can pass a simple id values, for example [1, 2, 3].
   * If you have multiple primary keys you need to pass object with property names and values specified,
   * for example [{ firstId: 1, secondId: 2 }, { firstId: 2, secondId: 3 }, ...]
   */
  public andWhereInIds(ids: unknown | Array<unknown>): this {
    return this.andWhere(this.getWhereInIdsCondition(ids));
  }

  /**
   * Adds new OR WHERE with conditions for the given ids.
   *
   * Ids are mixed.
   * It means if you have single primary key you can pass a simple id values, for example [1, 2, 3].
   * If you have multiple primary keys you need to pass object with property names and values specified,
   * for example [{ firstId: 1, secondId: 2 }, { firstId: 2, secondId: 3 }, ...]
   */
  public orWhereInIds(ids: unknown | Array<unknown>): this {
    return this.orWhere(this.getWhereInIdsCondition(ids));
  }

  /**
   * Sets HAVING condition in the query builder.
   * If you had previously HAVING expression defined,
   * calling this function will override previously set HAVING conditions.
   * Additionally you can add parameters used in where expression.
   */
  public having(having: string, parameters?: ObjectLiteral): this {
    this.expressionMap.havings.push({ type: 'simple', condition: having });
    if (parameters) this.setParameters(parameters);
    return this;
  }

  /**
   * Adds new AND HAVING condition in the query builder.
   * Additionally you can add parameters used in where expression.
   */
  public andHaving(having: string, parameters?: ObjectLiteral): this {
    this.expressionMap.havings.push({ type: 'and', condition: having });
    if (parameters) this.setParameters(parameters);
    return this;
  }

  /**
   * Adds new OR HAVING condition in the query builder.
   * Additionally you can add parameters used in where expression.
   */
  public orHaving(having: string, parameters?: ObjectLiteral): this {
    this.expressionMap.havings.push({ type: 'or', condition: having });
    if (parameters) this.setParameters(parameters);
    return this;
  }

  /**
   * Sets GROUP BY condition in the query builder.
   * If you had previously GROUP BY expression defined,
   * calling this function will override previously set GROUP BY conditions.
   */
  public groupBy(): this;

  /**
   * Sets GROUP BY condition in the query builder.
   * If you had previously GROUP BY expression defined,
   * calling this function will override previously set GROUP BY conditions.
   */
  public groupBy(groupBy: string): this;

  /**
   * Sets GROUP BY condition in the query builder.
   * If you had previously GROUP BY expression defined,
   * calling this function will override previously set GROUP BY conditions.
   */
  public groupBy(groupBy?: string): this {
    if (groupBy) {
      this.expressionMap.groupBys = [groupBy];
    } else {
      this.expressionMap.groupBys = [];
    }
    return this;
  }

  /**
   * Adds GROUP BY condition in the query builder.
   */
  public addGroupBy(groupBy: string): this {
    this.expressionMap.groupBys.push(groupBy);
    return this;
  }

  /**
   * Enables time travelling for the current query (only supported by cockroach currently)
   */
  public timeTravelQuery(): this {
    return this;
  }

  /**
   * Sets ORDER BY condition in the query builder.
   * If you had previously ORDER BY expression defined,
   * calling this function will override previously set ORDER BY conditions.
   *
   * Calling order by without order set will remove all previously set order bys.
   */
  public orderBy(): this;

  /**
   * Sets ORDER BY condition in the query builder.
   * If you had previously ORDER BY expression defined,
   * calling this function will override previously set ORDER BY conditions.
   */
  public orderBy(
    sort: string,
    order?: 'ASC' | 'DESC',
    nulls?: 'NULLS FIRST' | 'NULLS LAST'
  ): this;

  /**
   * Sets ORDER BY condition in the query builder.
   * If you had previously ORDER BY expression defined,
   * calling this function will override previously set ORDER BY conditions.
   */
  public orderBy(order: OrderByCondition): this;

  /**
   * Sets ORDER BY condition in the query builder.
   * If you had previously ORDER BY expression defined,
   * calling this function will override previously set ORDER BY conditions.
   */
  public orderBy(
    sort?: string | OrderByCondition,
    order: 'ASC' | 'DESC' = 'ASC',
    nulls?: 'NULLS FIRST' | 'NULLS LAST'
  ): this {
    if (order !== undefined && order !== 'ASC' && order !== 'DESC')
      throw new TypeORMError(
        `SelectQueryBuilder.addOrderBy "order" can accept only "ASC" and "DESC" values.`
      );
    if (
      nulls !== undefined &&
      nulls !== 'NULLS FIRST' &&
      nulls !== 'NULLS LAST'
    )
      throw new TypeORMError(
        `SelectQueryBuilder.addOrderBy "nulls" can accept only "NULLS FIRST" and "NULLS LAST" values.`
      );

    if (sort) {
      if (typeof sort === 'object') {
        this.expressionMap.orderBys = sort as OrderByCondition;
      } else {
        if (nulls) {
          this.expressionMap.orderBys = {
            [sort as string]: { order, nulls },
          };
        } else {
          this.expressionMap.orderBys = { [sort as string]: order };
        }
      }
    } else {
      this.expressionMap.orderBys = {};
    }
    return this;
  }

  /**
   * Adds ORDER BY condition in the query builder.
   */
  public addOrderBy(
    sort: string,
    order: 'ASC' | 'DESC' = 'ASC',
    nulls?: 'NULLS FIRST' | 'NULLS LAST'
  ): this {
    if (order !== undefined && order !== 'ASC' && order !== 'DESC')
      throw new TypeORMError(
        `SelectQueryBuilder.addOrderBy "order" can accept only "ASC" and "DESC" values.`
      );
    if (
      nulls !== undefined &&
      nulls !== 'NULLS FIRST' &&
      nulls !== 'NULLS LAST'
    )
      throw new TypeORMError(
        `SelectQueryBuilder.addOrderBy "nulls" can accept only "NULLS FIRST" and "NULLS LAST" values.`
      );

    if (nulls) {
      this.expressionMap.orderBys[sort] = { order, nulls };
    } else {
      this.expressionMap.orderBys[sort] = order;
    }
    return this;
  }

  /**
   * Sets LIMIT - maximum number of rows to be selected.
   * NOTE that it may not work as you expect if you are using joins.
   * If you want to implement pagination, and you are having join in your query,
   * then use the take method instead.
   */
  public limit(limit?: number): this {
    this.expressionMap.limit = this.normalizeNumber(limit);
    if (
      this.expressionMap.limit !== undefined &&
      isNaN(this.expressionMap.limit)
    )
      throw new TypeORMError(
        `Provided "limit" value is not a number. Please provide a numeric value.`
      );

    return this;
  }

  /**
   * Sets OFFSET - selection offset.
   * NOTE that it may not work as you expect if you are using joins.
   * If you want to implement pagination, and you are having join in your query,
   * then use the skip method instead.
   */
  public offset(offset?: number): this {
    this.expressionMap.offset = this.normalizeNumber(offset);
    if (
      this.expressionMap.offset !== undefined &&
      isNaN(this.expressionMap.offset)
    )
      throw new TypeORMError(
        `Provided "offset" value is not a number. Please provide a numeric value.`
      );

    return this;
  }

  /**
   * Sets maximal number of entities to take.
   */
  public take(take?: number): this {
    this.expressionMap.take = this.normalizeNumber(take);
    if (this.expressionMap.take !== undefined && isNaN(this.expressionMap.take))
      throw new TypeORMError(
        `Provided "take" value is not a number. Please provide a numeric value.`
      );

    return this;
  }

  /**
   * Sets number of entities to skip.
   */
  public skip(skip?: number): this {
    this.expressionMap.skip = this.normalizeNumber(skip);
    if (this.expressionMap.skip !== undefined && isNaN(this.expressionMap.skip))
      throw new TypeORMError(
        `Provided "skip" value is not a number. Please provide a numeric value.`
      );

    return this;
  }

  /**
   * Set certain index to be used by the query.
   *
   * @param index Name of index to be used.
   */
  public useIndex(index: string): this {
    this.expressionMap.useIndex = index;

    return this;
  }

  /**
   * Sets locking mode.
   */
  public setLock(lockMode: 'optimistic', lockVersion: number | Date): this;

  /**
   * Sets locking mode.
   */
  public setLock(
    lockMode:
      | 'pessimistic_read'
      | 'pessimistic_write'
      | 'dirty_read'
      /*
                "pessimistic_partial_write" and "pessimistic_write_or_fail" are deprecated and
                will be removed in a future version.

                Use setOnLocked instead.
             */
      | 'pessimistic_partial_write'
      | 'pessimistic_write_or_fail'
      | 'for_no_key_update'
      | 'for_key_share',
    lockVersion?: undefined,
    lockTables?: Array<string>
  ): this;

  /**
   * Sets locking mode.
   */
  public setLock(
    lockMode:
      | 'optimistic'
      | 'pessimistic_read'
      | 'pessimistic_write'
      | 'dirty_read'
      /*
                "pessimistic_partial_write" and "pessimistic_write_or_fail" are deprecated and
                will be removed in a future version.

                Use setOnLocked instead.
             */
      | 'pessimistic_partial_write'
      | 'pessimistic_write_or_fail'
      | 'for_no_key_update'
      | 'for_key_share',
    lockVersion?: number | Date,
    lockTables?: Array<string>
  ): this {
    this.expressionMap.lockMode = lockMode;
    this.expressionMap.lockVersion = lockVersion;
    this.expressionMap.lockTables = lockTables;
    return this;
  }

  /**
   * Sets lock handling by adding NO WAIT or SKIP LOCKED.
   */
  public setOnLocked(onLocked: 'nowait' | 'skip_locked'): this {
    this.expressionMap.onLocked = onLocked;
    return this;
  }

  /**
   * Disables the global condition of "non-deleted" for the entity with delete date columns.
   */
  public withDeleted(): this {
    this.expressionMap.withDeleted = true;
    return this;
  }

  /**
   * Gets first raw result returned by execution of generated query builder sql.
   */
  public async getRawOne<T = unknown>(): Promise<T | undefined> {
    return (await this.getRawMany())[0] as T | undefined;
  }

  /**
   * Gets all raw results returned by execution of generated query builder sql.
   */
  public async getRawMany<T = unknown>(): Promise<Array<T>> {
    if (this.expressionMap.lockMode === 'optimistic')
      throw new OptimisticLockCanNotBeUsedError();

    this.expressionMap.queryEntity = false;
    const queryRunner = this.obtainQueryRunner();
    let transactionStartedByUs = false;
    try {
      // start transaction if it was enabled
      if (
        this.expressionMap.useTransaction === true &&
        queryRunner.isTransactionActive === false
      ) {
        await queryRunner.startTransaction();
        transactionStartedByUs = true;
      }

      const results = (await this.loadRawResults(queryRunner)) as Array<T>;

      // close transaction if we started it
      if (transactionStartedByUs) {
        await queryRunner.commitTransaction();
      }

      return results;
    } catch (error) {
      // rollback transaction if we started it
      if (transactionStartedByUs) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          //nothing
        }
      }
      throw error;
    } finally {
      if (queryRunner !== this.queryRunner) {
        // means we created our own query runner
        await queryRunner.release();
      }
    }
  }

  /**
   * Executes sql generated by query builder and returns object with raw results and entities created from them.
   */
  public async getRawAndEntities<T = unknown>(): Promise<{
    entities: Array<Entity>;
    raw: Array<T>;
  }> {
    const queryRunner = this.obtainQueryRunner();
    let transactionStartedByUs = false;
    try {
      // start transaction if it was enabled
      if (
        this.expressionMap.useTransaction === true &&
        queryRunner.isTransactionActive === false
      ) {
        await queryRunner.startTransaction();
        transactionStartedByUs = true;
      }

      this.expressionMap.queryEntity = true;
      const results = await this.executeEntitiesAndRawResults(queryRunner);

      // close transaction if we started it
      if (transactionStartedByUs) {
        await queryRunner.commitTransaction();
      }

      return results as { entities: Array<Entity>; raw: Array<T> };
    } catch (error) {
      // rollback transaction if we started it
      if (transactionStartedByUs) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // do nothing
        }
      }
      throw error;
    } finally {
      if (queryRunner !== this.queryRunner)
        // means we created our own query runner
        await queryRunner.release();
    }
  }

  /**
   * Gets single entity returned by execution of generated query builder sql.
   */
  public async getOne(): Promise<Entity | null> {
    const results = await this.getRawAndEntities();
    const result = results.entities[0] as Entity;

    if (
      result &&
      this.expressionMap.lockMode === 'optimistic' &&
      this.expressionMap.lockVersion
    ) {
      const metadata = this.expressionMap.mainAlias!.metadata;

      if (this.expressionMap.lockVersion instanceof Date) {
        const actualVersion = metadata.updateDateColumn!.getEntityValue(result); // what if columns arent set?
        if (
          actualVersion instanceof Date &&
          actualVersion.getTime() !== this.expressionMap.lockVersion.getTime()
        )
          throw new OptimisticLockVersionMismatchError(
            metadata.name,
            this.expressionMap.lockVersion,
            actualVersion
          );
      } else {
        const actualVersion = metadata.versionColumn!.getEntityValue(
          result
        ) as unknown as number; // what if columns arent set?
        if ((actualVersion as number) !== this.expressionMap.lockVersion)
          throw new OptimisticLockVersionMismatchError(
            metadata.name,
            this.expressionMap.lockVersion,
            actualVersion
          );
      }
    }

    if (result === undefined) {
      return null;
    }
    return result;
  }

  /**
   * Gets the first entity returned by execution of generated query builder sql or rejects the returned promise on error.
   */
  public async getOneOrFail(): Promise<Entity> {
    const entity = await this.getOne();

    if (!entity) {
      throw new EntityNotFoundError(
        this.expressionMap.mainAlias!.target,
        this.expressionMap.parameters
      );
    }

    return entity;
  }

  /**
   * Gets entities returned by execution of generated query builder sql.
   */
  public async getMany(): Promise<Array<Entity>> {
    if (this.expressionMap.lockMode === 'optimistic')
      throw new OptimisticLockCanNotBeUsedError();

    const results = await this.getRawAndEntities();
    return results.entities;
  }

  /**
   * Gets count - number of entities selected by sql generated by this query builder.
   * Count excludes all limitations set by offset, limit, skip, and take.
   */
  public async getCount(): Promise<number> {
    if (this.expressionMap.lockMode === 'optimistic')
      throw new OptimisticLockCanNotBeUsedError();

    const queryRunner = this.obtainQueryRunner();
    let transactionStartedByUs = false;
    try {
      // start transaction if it was enabled
      if (
        this.expressionMap.useTransaction === true &&
        queryRunner.isTransactionActive === false
      ) {
        await queryRunner.startTransaction();
        transactionStartedByUs = true;
      }

      this.expressionMap.queryEntity = false;
      const results = await this.executeCountQuery(queryRunner);

      // close transaction if we started it
      if (transactionStartedByUs) {
        await queryRunner.commitTransaction();
      }

      return results;
    } catch (error) {
      // rollback transaction if we started it
      if (transactionStartedByUs) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          //nothing
        }
      }
      throw error;
    } finally {
      if (queryRunner !== this.queryRunner)
        // means we created our own query runner
        await queryRunner.release();
    }
  }

  /**
   * Gets exists
   * Returns whether any rows exists matching current query.
   */
  public async getExists(): Promise<boolean> {
    if (this.expressionMap.lockMode === 'optimistic')
      throw new OptimisticLockCanNotBeUsedError();

    const queryRunner = this.obtainQueryRunner();
    let transactionStartedByUs = false;
    try {
      // start transaction if it was enabled
      if (
        this.expressionMap.useTransaction === true &&
        queryRunner.isTransactionActive === false
      ) {
        await queryRunner.startTransaction();
        transactionStartedByUs = true;
      }

      this.expressionMap.queryEntity = false;
      const results = await this.executeExistsQuery(queryRunner);

      // close transaction if we started it
      if (transactionStartedByUs) {
        await queryRunner.commitTransaction();
      }

      return results;
    } catch (error) {
      // rollback transaction if we started it
      if (transactionStartedByUs) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          //nothing
        }
      }
      throw error;
    } finally {
      if (queryRunner !== this.queryRunner)
        // means we created our own query runner
        await queryRunner.release();
    }
  }

  /**
   * Executes built SQL query and returns entities and overall entities count (without limitation).
   * This method is useful to build pagination.
   */
  public async getManyAndCount(): Promise<[Array<Entity>, number]> {
    if (this.expressionMap.lockMode === 'optimistic')
      throw new OptimisticLockCanNotBeUsedError();

    const queryRunner = this.obtainQueryRunner();
    let transactionStartedByUs = false;
    try {
      // start transaction if it was enabled
      if (
        this.expressionMap.useTransaction === true &&
        queryRunner.isTransactionActive === false
      ) {
        await queryRunner.startTransaction();
        transactionStartedByUs = true;
      }

      this.expressionMap.queryEntity = true;
      const entitiesAndRaw =
        await this.executeEntitiesAndRawResults(queryRunner);
      this.expressionMap.queryEntity = false;

      let count: number | undefined = this.lazyCount(entitiesAndRaw);
      if (count === undefined) {
        const cacheId = this.expressionMap.cacheId;
        // Creates a new cacheId for the count query, or it will retrieve the above query results
        // and count will return 0.
        if (cacheId) {
          this.expressionMap.cacheId = `${cacheId}-count`;
        }
        count = await this.executeCountQuery(queryRunner);
      }
      const results: [Array<Entity>, number] = [entitiesAndRaw.entities, count];

      // close transaction if we started it
      if (transactionStartedByUs) {
        await queryRunner.commitTransaction();
      }

      return results;
    } catch (error) {
      // rollback transaction if we started it
      if (transactionStartedByUs) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          //nothing
        }
      }
      throw error;
    } finally {
      if (queryRunner !== this.queryRunner)
        // means we created our own query runner
        await queryRunner.release();
    }
  }

  private lazyCount(entitiesAndRaw: {
    entities: Array<Entity>;
    raw: Array<unknown>;
  }): number | undefined {
    const hasLimit =
      this.expressionMap.limit !== undefined &&
      this.expressionMap.limit !== null;
    if (this.expressionMap.joinAttributes.length > 0 && hasLimit) {
      return undefined;
    }

    const hasTake =
      this.expressionMap.take !== undefined && this.expressionMap.take !== null;

    // limit overrides take when no join is defined
    const maxResults = hasLimit
      ? this.expressionMap.limit
      : hasTake
        ? this.expressionMap.take
        : undefined;

    if (
      maxResults !== undefined &&
      entitiesAndRaw.entities.length === maxResults
    ) {
      // stop here when the result set contains the max number of rows; we need to execute a full count
      return undefined;
    }

    const hasSkip =
      this.expressionMap.skip !== undefined &&
      this.expressionMap.skip !== null &&
      this.expressionMap.skip > 0;
    const hasOffset =
      this.expressionMap.offset !== undefined &&
      this.expressionMap.offset !== null &&
      this.expressionMap.offset > 0;

    if (entitiesAndRaw.entities.length === 0 && (hasSkip || hasOffset)) {
      // when skip or offset were used and no results found, we need to execute a full count
      // (the given offset may have exceeded the actual number of rows)
      return undefined;
    }

    // offset overrides skip when no join is defined
    const previousResults: number = hasOffset
      ? this.expressionMap.offset!
      : hasSkip
        ? this.expressionMap.skip!
        : 0;

    return entitiesAndRaw.entities.length + previousResults;
  }

  /**
   * Executes built SQL query and returns raw data stream.
   */
  public async stream(): Promise<ReadStream> {
    this.expressionMap.queryEntity = false;
    const [sql, parameters] = this.getQueryAndParameters();
    const queryRunner = this.obtainQueryRunner();
    let transactionStartedByUs = false;
    try {
      // start transaction if it was enabled
      if (
        this.expressionMap.useTransaction === true &&
        queryRunner.isTransactionActive === false
      ) {
        await queryRunner.startTransaction();
        transactionStartedByUs = true;
      }

      const releaseFn = (): Promise<void> | undefined => {
        if (queryRunner !== this.queryRunner)
          // means we created our own query runner
          return queryRunner.release();
        return;
      };
      const results = queryRunner.stream(sql, parameters, releaseFn, releaseFn);

      // close transaction if we started it
      if (transactionStartedByUs) {
        await queryRunner.commitTransaction();
      }

      return results;
    } catch (error) {
      // rollback transaction if we started it
      if (transactionStartedByUs) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          //nothing
        }
      }
      throw error;
    }
  }

  /**
   * Enables or disables query result caching.
   */
  public cache(enabled: boolean): this;

  /**
   * Enables query result caching and sets in milliseconds in which cache will expire.
   * If not set then global caching time will be used.
   */
  public cache(milliseconds: number): this;

  /**
   * Enables query result caching and sets cache id and milliseconds in which cache will expire.
   */
  public cache(id: unknown, milliseconds?: number): this;

  /**
   * Enables or disables query result caching.
   */
  public cache(
    enabledOrMillisecondsOrId: boolean | number | string,
    maybeMilliseconds?: number
  ): this {
    if (typeof enabledOrMillisecondsOrId === 'boolean') {
      this.expressionMap.cache = enabledOrMillisecondsOrId;
    } else if (typeof enabledOrMillisecondsOrId === 'number') {
      this.expressionMap.cache = true;
      this.expressionMap.cacheDuration = enabledOrMillisecondsOrId;
    } else if (
      typeof enabledOrMillisecondsOrId === 'string' ||
      typeof enabledOrMillisecondsOrId === 'number'
    ) {
      this.expressionMap.cache = true;
      this.expressionMap.cacheId = enabledOrMillisecondsOrId;
    }

    if (maybeMilliseconds) {
      this.expressionMap.cacheDuration = maybeMilliseconds;
    }

    return this;
  }

  /**
   * Sets extra options that can be used to configure how query builder works.
   */
  public setOption(option: SelectQueryBuilderOption): this {
    this.expressionMap.options.push(option);
    return this;
  }

  // -------------------------------------------------------------------------
  // Protected Methods
  // -------------------------------------------------------------------------

  protected join(
    direction: 'INNER' | 'LEFT',
    entityOrProperty:
      | TFunction
      | string
      | ((
          qb: SelectQueryBuilder<ObjectLiteral>
        ) => SelectQueryBuilder<ObjectLiteral>),
    aliasName: string,
    condition?: string,
    parameters?: ObjectLiteral,
    mapToProperty?: string,
    isMappingMany?: boolean,
    mapAsEntity?: TFunction | string
  ): void {
    if (parameters) {
      this.setParameters(parameters);
    }

    const joinAttribute = new JoinAttribute(
      this.connection,
      this.expressionMap
    );
    joinAttribute.direction = direction;
    joinAttribute.mapAsEntity = mapAsEntity;
    joinAttribute.mapToProperty = mapToProperty;
    joinAttribute.isMappingMany = isMappingMany;
    joinAttribute.entityOrProperty = entityOrProperty as TFunction | string; // relationName
    joinAttribute.condition = condition; // joinInverseSideCondition
    // joinAttribute.junctionAlias = joinAttribute.relation.isOwning ? parentAlias + "_" + destinationTableAlias : destinationTableAlias + "_" + parentAlias;
    this.expressionMap.joinAttributes.push(joinAttribute);

    const joinAttributeMetadata = joinAttribute.metadata;
    if (joinAttributeMetadata) {
      if (
        joinAttributeMetadata.deleteDateColumn &&
        !this.expressionMap.withDeleted
      ) {
        const conditionDeleteColumn = `${aliasName}.${joinAttributeMetadata.deleteDateColumn.propertyName} IS NULL`;
        joinAttribute.condition = joinAttribute.condition
          ? ` ${joinAttribute.condition} AND ${conditionDeleteColumn}`
          : `${conditionDeleteColumn}`;
      }
      // todo: find and set metadata right there?
      joinAttribute.alias = this.expressionMap.createAlias({
        type: 'join',
        name: aliasName,
        metadata: joinAttributeMetadata,
      });
      if (
        joinAttribute.relation &&
        joinAttribute.relation.junctionEntityMetadata
      ) {
        this.expressionMap.createAlias({
          type: 'join',
          name: joinAttribute.junctionAlias,
          metadata: joinAttribute.relation.junctionEntityMetadata,
        });
      }
    } else {
      let subQuery = '';
      if (typeof entityOrProperty === 'function') {
        const subQueryBuilder: SelectQueryBuilder<ObjectLiteral> = (
          entityOrProperty as TFunction
        )(
          (this as unknown as SelectQueryBuilder<ObjectLiteral>).subQuery()
        ) as SelectQueryBuilder<ObjectLiteral>;
        this.setParameters(subQueryBuilder.getParameters());
        subQuery = subQueryBuilder.getQuery();
      } else {
        subQuery = entityOrProperty;
      }
      const isSubQuery =
        typeof entityOrProperty === 'function' ||
        (entityOrProperty.substr(0, 1) === '(' &&
          entityOrProperty.substr(-1) === ')');
      joinAttribute.alias = this.expressionMap.createAlias({
        type: 'join',
        name: aliasName,
        tablePath:
          isSubQuery === false ? (entityOrProperty as string) : undefined,
        subQuery: isSubQuery === true ? subQuery : undefined,
      });
    }
  }

  /**
   * Creates "SELECT FROM" part of SQL query.
   */
  protected createSelectExpression(): string {
    if (!this.expressionMap.mainAlias)
      throw new TypeORMError(
        'Cannot build query because main alias is not set (call qb#from method)'
      );

    // todo throw exception if selects or from is missing

    const allSelects: Array<SelectQuery> = [];
    const excludedSelects: Array<SelectQuery> = [];

    if (this.expressionMap.mainAlias.hasMetadata) {
      const metadata = this.expressionMap.mainAlias.metadata;
      allSelects.push(
        ...this.buildEscapedEntityColumnSelects(
          this.expressionMap.mainAlias.name,
          metadata
        )
      );
      excludedSelects.push(
        ...this.findEntityColumnSelects(
          this.expressionMap.mainAlias.name,
          metadata
        )
      );
    }

    // add selects from joins
    this.expressionMap.joinAttributes.forEach((join) => {
      if (join.metadata) {
        allSelects.push(
          ...this.buildEscapedEntityColumnSelects(
            join.alias.name!,
            join.metadata
          )
        );
        excludedSelects.push(
          ...this.findEntityColumnSelects(join.alias.name!, join.metadata)
        );
      } else {
        const hasMainAlias = this.expressionMap.selects.some(
          (select) => select.selection === join.alias.name
        );
        if (hasMainAlias) {
          allSelects.push({
            selection: this.escape(join.alias.name!) + '.*',
          });
          const excludedSelect = this.expressionMap.selects.find(
            (select) => select.selection === join.alias.name
          );
          excludedSelects.push(excludedSelect!);
        }
      }
    });

    // add all other selects
    this.expressionMap.selects
      .filter((select) => excludedSelects.indexOf(select) === -1)
      .forEach((select) =>
        allSelects.push({
          selection: this.replacePropertyNames(select.selection),
          aliasName: select.aliasName,
        })
      );

    // if still selection is empty, then simply set it to all (*)
    if (allSelects.length === 0) allSelects.push({ selection: '*' });

    // create a selection query
    const froms = this.expressionMap.aliases
      .filter(
        (alias) => alias.type === 'from' && (alias.tablePath || alias.subQuery)
      )
      .map((alias) => {
        if (alias.subQuery)
          return alias.subQuery + ' ' + this.escape(alias.name);

        return (
          this.getTableName(alias.tablePath!) + ' ' + this.escape(alias.name)
        );
      });

    const select = this.createSelectDistinctExpression();
    const selection = allSelects
      .map(
        (select) =>
          select.selection +
          (select.aliasName ? ' AS ' + this.escape(select.aliasName) : '')
      )
      .join(', ');

    return (
      select +
      selection +
      ' FROM ' +
      froms.join(', ') +
      this.createTableLockExpression()
    );
  }

  /**
   * Creates select | select distinct part of SQL query.
   */
  protected createSelectDistinctExpression(): string {
    const { selectDistinct, selectDistinctOn } = this.expressionMap;
    const { driver } = this.connection;

    let select = 'SELECT ';

    if (DriverUtils.isPostgresFamily(driver) && selectDistinctOn.length > 0) {
      const selectDistinctOnMap = selectDistinctOn
        .map((on) => this.replacePropertyNames(on))
        .join(', ');

      select = `SELECT DISTINCT ON (${selectDistinctOnMap}) `;
    } else if (selectDistinct) {
      select = 'SELECT DISTINCT ';
    }

    return select;
  }

  /**
   * Creates "JOIN" part of SQL query.
   */
  protected createJoinExpression(): string {
    // examples:
    // select from owning side
    // qb.select("post")
    //     .leftJoinAndSelect("post.category", "category");
    // select from non-owning side
    // qb.select("category")
    //     .leftJoinAndSelect("category.post", "post");

    const joins = this.expressionMap.joinAttributes.map((joinAttr) => {
      const relation = joinAttr.relation;
      const destinationTableName = joinAttr.tablePath;
      const destinationTableAlias = joinAttr.alias.name;
      let appendedCondition = joinAttr.condition
        ? ' AND (' + joinAttr.condition + ')'
        : '';
      const parentAlias = joinAttr.parentAlias;

      // if join was build without relation (e.g. without "post.category") then it means that we have direct
      // table to join, without junction table involved. This means we simply join direct table.
      if (!parentAlias || !relation) {
        const destinationJoin = joinAttr.alias.subQuery
          ? joinAttr.alias.subQuery
          : this.getTableName(destinationTableName);
        return (
          ' ' +
          joinAttr.direction +
          ' JOIN ' +
          destinationJoin +
          ' ' +
          this.escape(destinationTableAlias) +
          this.createTableLockExpression() +
          (joinAttr.condition
            ? ' ON ' + this.replacePropertyNames(joinAttr.condition)
            : '')
        );
      }

      // if real entity relation is involved
      if (relation.isManyToOne || relation.isOneToOneOwner) {
        // JOIN `category` `category` ON `category`.`id` = `post`.`categoryId`
        const condition = relation.joinColumns
          .map((joinColumn) => {
            return (
              destinationTableAlias +
              '.' +
              joinColumn.referencedColumn!.propertyPath +
              '=' +
              parentAlias +
              '.' +
              relation.propertyPath +
              '.' +
              joinColumn.referencedColumn!.propertyPath
            );
          })
          .join(' AND ');

        return (
          ' ' +
          joinAttr.direction +
          ' JOIN ' +
          this.getTableName(destinationTableName) +
          ' ' +
          this.escape(destinationTableAlias) +
          this.createTableLockExpression() +
          ' ON ' +
          this.replacePropertyNames(condition + appendedCondition)
        );
      } else if (relation.isOneToMany || relation.isOneToOneNotOwner) {
        // JOIN `post` `post` ON `post`.`categoryId` = `category`.`id`
        const condition = relation
          .inverseRelation!.joinColumns.map((joinColumn) => {
            if (
              relation.inverseEntityMetadata.tableType === 'entity-child' &&
              relation.inverseEntityMetadata.discriminatorColumn
            ) {
              appendedCondition +=
                ' AND ' +
                destinationTableAlias +
                '.' +
                relation.inverseEntityMetadata.discriminatorColumn
                  .databaseName +
                "='" +
                relation.inverseEntityMetadata.discriminatorValue +
                "'";
            }

            return (
              destinationTableAlias +
              '.' +
              relation.inverseRelation!.propertyPath +
              '.' +
              joinColumn.referencedColumn!.propertyPath +
              '=' +
              parentAlias +
              '.' +
              joinColumn.referencedColumn!.propertyPath
            );
          })
          .join(' AND ');

        if (!condition)
          throw new TypeORMError(
            `Relation ${relation.entityMetadata.name}.${relation.propertyName} does not have join columns.`
          );

        return (
          ' ' +
          joinAttr.direction +
          ' JOIN ' +
          this.getTableName(destinationTableName) +
          ' ' +
          this.escape(destinationTableAlias) +
          this.createTableLockExpression() +
          ' ON ' +
          this.replacePropertyNames(condition + appendedCondition)
        );
      } else {
        // means many-to-many
        const junctionTableName = relation.junctionEntityMetadata!.tablePath;

        const junctionAlias = joinAttr.junctionAlias;
        let junctionCondition = '',
          destinationCondition = '';

        if (relation.isOwning) {
          junctionCondition = relation.joinColumns
            .map((joinColumn) => {
              // `post_category`.`postId` = `post`.`id`
              return (
                junctionAlias +
                '.' +
                joinColumn.propertyPath +
                '=' +
                parentAlias +
                '.' +
                joinColumn.referencedColumn!.propertyPath
              );
            })
            .join(' AND ');

          destinationCondition = relation.inverseJoinColumns
            .map((joinColumn) => {
              // `category`.`id` = `post_category`.`categoryId`
              return (
                destinationTableAlias +
                '.' +
                joinColumn.referencedColumn!.propertyPath +
                '=' +
                junctionAlias +
                '.' +
                joinColumn.propertyPath
              );
            })
            .join(' AND ');
        } else {
          junctionCondition = relation
            .inverseRelation!.inverseJoinColumns.map((joinColumn) => {
              // `post_category`.`categoryId` = `category`.`id`
              return (
                junctionAlias +
                '.' +
                joinColumn.propertyPath +
                '=' +
                parentAlias +
                '.' +
                joinColumn.referencedColumn!.propertyPath
              );
            })
            .join(' AND ');

          destinationCondition = relation
            .inverseRelation!.joinColumns.map((joinColumn) => {
              // `post`.`id` = `post_category`.`postId`
              return (
                destinationTableAlias +
                '.' +
                joinColumn.referencedColumn!.propertyPath +
                '=' +
                junctionAlias +
                '.' +
                joinColumn.propertyPath
              );
            })
            .join(' AND ');
        }

        return (
          ' ' +
          joinAttr.direction +
          ' JOIN ' +
          this.getTableName(junctionTableName) +
          ' ' +
          this.escape(junctionAlias) +
          this.createTableLockExpression() +
          ' ON ' +
          this.replacePropertyNames(junctionCondition) +
          ' ' +
          joinAttr.direction +
          ' JOIN ' +
          this.getTableName(destinationTableName) +
          ' ' +
          this.escape(destinationTableAlias) +
          this.createTableLockExpression() +
          ' ON ' +
          this.replacePropertyNames(destinationCondition + appendedCondition)
        );
      }
    });

    return joins.join(' ');
  }

  /**
   * Creates "GROUP BY" part of SQL query.
   */
  protected createGroupByExpression(): string {
    if (!this.expressionMap.groupBys || !this.expressionMap.groupBys.length)
      return '';
    return (
      ' GROUP BY ' +
      this.replacePropertyNames(this.expressionMap.groupBys.join(', '))
    );
  }

  /**
   * Creates "ORDER BY" part of SQL query.
   */
  protected createOrderByExpression(): string {
    const orderBys = this.expressionMap.allOrderBys;
    if (Object.keys(orderBys).length === 0) return '';

    return (
      ' ORDER BY ' +
      Object.keys(orderBys)
        .map((columnName) => {
          const orderEntry = orderBys[columnName];
          const orderValue =
            typeof orderEntry === 'string'
              ? orderEntry
              : ((orderEntry as ObjectLiteral).order as string) +
                ' ' +
                ((orderEntry as ObjectLiteral).nulls as string);
          const selection = this.expressionMap.selects.find(
            (s) => s.selection === columnName
          );
          if (
            selection &&
            !selection.aliasName &&
            columnName.indexOf('.') !== -1
          ) {
            const criteriaParts = columnName.split('.');
            const aliasName = criteriaParts[0]!;
            const propertyPath = criteriaParts.slice(1).join('.');
            const alias = this.expressionMap.aliases.find(
              (alias) => alias.name === aliasName
            );
            if (alias) {
              const column =
                alias.metadata.findColumnWithPropertyPath(propertyPath);
              if (column) {
                const databaseName = column.databaseName as string;
                const orderAlias = DriverUtils.buildAlias(
                  this.connection.driver,
                  undefined,
                  aliasName,
                  databaseName
                ) as string;
                const orderValueNonNull = orderValue as string;
                return this.escape(orderAlias) + ' ' + orderValueNonNull;
              }
            }
          }

          const orderValueNonNull = orderValue as string;
          return (
            this.replacePropertyNames(columnName) + ' ' + orderValueNonNull
          );
        })
        .join(', ')
    );
  }

  /**
   * Creates "LIMIT" and "OFFSET" parts of SQL query.
   */
  protected createLimitOffsetExpression(): string {
    // in the case if nothing is joined in the query builder we don't need to make two requests to get paginated results
    // we can use regular limit / offset, that's why we add offset and limit construction here based on skip and take values
    let offset: number | undefined = this.expressionMap.offset,
      limit: number | undefined = this.expressionMap.limit;
    if (
      offset === undefined &&
      limit === undefined &&
      this.expressionMap.joinAttributes.length === 0
    ) {
      offset = this.expressionMap.skip;
      limit = this.expressionMap.take;
    }

    // Helper functions to check if values are set (including 0)
    const hasLimit = limit !== undefined && limit !== null;
    const hasOffset = offset !== undefined && offset !== null;
    if (this.driver.options.type === 'oracle') {
      if (hasLimit && hasOffset)
        return ' OFFSET ' + offset + ' ROWS FETCH NEXT ' + limit + ' ROWS ONLY';
      if (hasLimit) return ' FETCH NEXT ' + limit + ' ROWS ONLY';
      if (hasOffset) return ' OFFSET ' + offset + ' ROWS';
    } else {
      if (hasLimit && hasOffset) return ' LIMIT ' + limit + ' OFFSET ' + offset;
      if (hasLimit) return ' LIMIT ' + limit;
      if (hasOffset) return ' OFFSET ' + offset;
    }

    return '';
  }

  /**
   * Creates "LOCK" part of SELECT Query after table Clause
   * ex.
   *  SELECT 1
   *  FROM USER U WITH (NOLOCK)
   *  JOIN ORDER O WITH (NOLOCK)
   *      ON U.ID=O.OrderID
   */
  private createTableLockExpression(): string {
    return '';
  }

  /**
   * Creates "LOCK" part of SQL query.
   */
  protected createLockExpression(): string {
    const driver = this.connection.driver;

    let lockTablesClause = '';

    if (this.expressionMap.lockTables) {
      if (!DriverUtils.isPostgresFamily(driver)) {
        throw new TypeORMError('Lock tables not supported in selected driver');
      }
      if (this.expressionMap.lockTables.length < 1) {
        throw new TypeORMError('lockTables cannot be an empty array');
      }
      lockTablesClause = ' OF ' + this.expressionMap.lockTables.join(', ');
    }

    let onLockExpression = '';
    if (this.expressionMap.onLocked === 'nowait') {
      onLockExpression = ' NOWAIT';
    } else if (this.expressionMap.onLocked === 'skip_locked') {
      onLockExpression = ' SKIP LOCKED';
    }
    switch (this.expressionMap.lockMode) {
      case 'pessimistic_read':
        if (DriverUtils.isPostgresFamily(driver)) {
          return ' FOR SHARE' + lockTablesClause + onLockExpression;
        } else if (driver.options.type === 'oracle') {
          return ' FOR UPDATE';
        } else {
          throw new LockNotSupportedOnGivenDriverError();
        }
      case 'pessimistic_write':
        if (DriverUtils.isPostgresFamily(driver)) {
          return ' FOR UPDATE' + lockTablesClause + onLockExpression;
        } else {
          throw new LockNotSupportedOnGivenDriverError();
        }
      case 'pessimistic_partial_write':
        if (DriverUtils.isPostgresFamily(driver)) {
          return ' FOR UPDATE' + lockTablesClause + ' SKIP LOCKED';
        } else {
          throw new LockNotSupportedOnGivenDriverError();
        }
      case 'pessimistic_write_or_fail':
        if (DriverUtils.isPostgresFamily(driver)) {
          return ' FOR UPDATE' + lockTablesClause + ' NOWAIT';
        } else {
          throw new LockNotSupportedOnGivenDriverError();
        }
      case 'for_no_key_update':
        if (DriverUtils.isPostgresFamily(driver)) {
          return ' FOR NO KEY UPDATE' + lockTablesClause + onLockExpression;
        } else {
          throw new LockNotSupportedOnGivenDriverError();
        }
      case 'for_key_share':
        if (DriverUtils.isPostgresFamily(driver)) {
          return ' FOR KEY SHARE' + lockTablesClause + onLockExpression;
        } else {
          throw new LockNotSupportedOnGivenDriverError();
        }
      default:
        return '';
    }
  }

  /**
   * Creates "HAVING" part of SQL query.
   */
  protected createHavingExpression(): string {
    if (!this.expressionMap.havings || !this.expressionMap.havings.length)
      return '';
    const conditions = this.expressionMap.havings
      .map((having, index) => {
        switch (having.type) {
          case 'and':
            return (
              (index > 0 ? 'AND ' : '') +
              this.replacePropertyNames(having.condition)
            );
          case 'or':
            return (
              (index > 0 ? 'OR ' : '') +
              this.replacePropertyNames(having.condition)
            );
          default:
            return this.replacePropertyNames(having.condition);
        }
      })
      .join(' ');

    if (!conditions.length) return '';
    return ' HAVING ' + conditions;
  }

  protected buildEscapedEntityColumnSelects(
    aliasName: string,
    metadata: EntityMetadata
  ): Array<SelectQuery> {
    const hasMainAlias = this.expressionMap.selects.some(
      (select) => select.selection === aliasName
    );

    const columns: Array<ColumnMetadata> = [];
    if (hasMainAlias) {
      columns.push(
        ...metadata.columns.filter((column) => column.isSelect === true)
      );
    }
    columns.push(
      ...metadata.columns.filter((column) => {
        return this.expressionMap.selects.some(
          (select) => select.selection === aliasName + '.' + column.propertyPath
        );
      })
    );

    // if user used partial selection and did not select some primary columns which are required to be selected
    // we select those primary columns and mark them as "virtual". Later virtual column values will be removed from final entity
    // to make entity contain exactly what user selected
    if (columns.length === 0)
      // however not in the case when nothing (even partial) was selected from this target (for example joins without selection)
      return [];

    const nonSelectedPrimaryColumns = this.expressionMap.queryEntity
      ? metadata.primaryColumns.filter(
          (primaryColumn) => columns.indexOf(primaryColumn) === -1
        )
      : [];
    const allColumns = [...columns, ...nonSelectedPrimaryColumns];
    const finalSelects: Array<SelectQuery> = [];

    const escapedAliasName = this.escape(aliasName);
    allColumns.forEach((column) => {
      let selectionPath =
        escapedAliasName + '.' + this.escape(column.databaseName);

      if (column.isVirtualProperty && column.query) {
        selectionPath = `(${column.query(escapedAliasName)})`;
      }

      if (this.driver.spatialTypes.indexOf(column.type) !== -1) {
        if (DriverUtils.isPostgresFamily(this.connection.driver))
          if (column.precision) {
            // cast to JSON to trigger parsing in the driver
            selectionPath = `ST_AsGeoJSON(${selectionPath}, ${column.precision})::json`;
          } else {
            selectionPath = `ST_AsGeoJSON(${selectionPath})::json`;
          }
      }

      const selections = this.expressionMap.selects.filter(
        (select) => select.selection === aliasName + '.' + column.propertyPath
      );
      if (selections.length) {
        selections.forEach((selection) => {
          finalSelects.push({
            selection: selectionPath,
            aliasName: selection.aliasName
              ? selection.aliasName
              : DriverUtils.buildAlias(
                  this.connection.driver,
                  undefined,
                  aliasName,
                  column.databaseName
                ),
            // todo: need to keep in mind that custom selection.aliasName breaks hydrator. fix it later!
            virtual: selection.virtual,
          });
        });
      } else {
        finalSelects.push({
          selection: selectionPath,
          aliasName: DriverUtils.buildAlias(
            this.connection.driver,
            undefined,
            aliasName,
            column.databaseName
          ),
          // todo: need to keep in mind that custom selection.aliasName breaks hydrator. fix it later!
          virtual: hasMainAlias,
        });
      }
    });
    return finalSelects;
  }

  protected findEntityColumnSelects(
    aliasName: string,
    metadata: EntityMetadata
  ): Array<SelectQuery> {
    return this.expressionMap.selects.filter(
      (select) =>
        select.selection === aliasName ||
        metadata.columns.some(
          (column) => select.selection === aliasName + '.' + column.propertyPath
        )
    );
  }

  private computeCountExpression(): string {
    const mainAlias = this.expressionMap.mainAlias!.name; // todo: will this work with "fromTableName"?
    const metadata = this.expressionMap.mainAlias!.metadata;

    const primaryColumns = metadata.primaryColumns;
    const distinctAlias = this.escape(mainAlias);

    // If we aren't doing anything that will create a join, we can use a simpler `COUNT` instead
    // so we prevent poor query patterns in the most likely cases
    if (
      this.expressionMap.joinAttributes.length === 0 &&
      this.expressionMap.relationIdAttributes.length === 0 &&
      this.expressionMap.relationCountAttributes.length === 0
    ) {
      return 'COUNT(1)';
    }

    // For everything else, we'll need to do some hackery to get the correct count values.

    if (DriverUtils.isPostgresFamily(this.connection.driver)) {
      // Postgres and CockroachDB can pass multiple parameters to the `DISTINCT` function
      // https://www.postgresql.org/docs/9.5/sql-select.html#SQL-DISTINCT
      return (
        'COUNT(DISTINCT(' +
        primaryColumns
          .map((c) => `${distinctAlias}.${this.escape(c.databaseName)}`)
          .join(', ') +
        '))'
      );
    }

    // If all else fails, fall back to a `COUNT` and `DISTINCT` across all the primary columns concatenated.
    // Per the SQL spec, this is the canonical string concatenation mechanism which is most
    // likely to work across servers implementing the SQL standard.

    // Please note, if there is only one primary column that the concatenation does not occur in this
    // query and the query is a standard `COUNT DISTINCT` in that case.

    return (
      `COUNT(DISTINCT(` +
      primaryColumns
        .map((c) => `${distinctAlias}.${this.escape(c.databaseName)}`)
        .join(" || '|;|' || ") +
      '))'
    );
  }

  protected async executeCountQuery(queryRunner: QueryRunner): Promise<number> {
    const countSql = this.computeCountExpression();

    const results = (await (this.clone() as SelectQueryBuilder<Entity>)
      .orderBy()
      .groupBy()
      .offset(undefined)
      .limit(undefined)
      .skip(undefined)
      .take(undefined)
      .select(countSql, 'cnt')
      .setOption('disable-global-order')
      .loadRawResults(queryRunner)) as Array<Record<string, string>>;

    if (!results || !results[0] || !results[0]['cnt']) return 0;
    return parseInt(results[0]['cnt']);
  }

  protected async executeExistsQuery(
    queryRunner: QueryRunner
  ): Promise<boolean> {
    const results = (await this.connection
      .createQueryBuilder()
      .fromDummy()
      .select('1', 'row_exists')
      .whereExists(this as unknown as SelectQueryBuilder<ObjectLiteral>)
      .limit(1)
      .loadRawResults(queryRunner)) as Array<unknown>;

    return results.length > 0;
  }

  protected applyFindOptions(): void {
    // todo: convert relations: string[] to object map to simplify code
    // todo: same with selects

    if (this.expressionMap.mainAlias!.metadata) {
      if (this.findOptions.relationLoadStrategy) {
        this.expressionMap.relationLoadStrategy =
          this.findOptions.relationLoadStrategy;
      }

      if (this.findOptions.comment) {
        this.comment(this.findOptions.comment);
      }

      if (this.findOptions.withDeleted) {
        this.withDeleted();
      }

      if (this.findOptions.select) {
        const select = Array.isArray(this.findOptions.select)
          ? OrmUtils.propertyPathsToTruthyObject(
              this.findOptions.select as Array<string>
            )
          : this.findOptions.select;

        this.buildSelect(
          select,
          this.expressionMap.mainAlias!.metadata,
          this.expressionMap.mainAlias!.name
        );
      }

      if (this.selects.length) {
        this.select(this.selects);
      }

      this.selects = [];

      if (this.findOptions.relations) {
        const relations = Array.isArray(this.findOptions.relations)
          ? OrmUtils.propertyPathsToTruthyObject(this.findOptions.relations)
          : this.findOptions.relations;

        this.buildRelations(
          relations,
          typeof this.findOptions.select === 'object'
            ? (this.findOptions.select as FindOptionsSelect<ObjectLiteral>)
            : undefined,
          this.expressionMap.mainAlias!.metadata,
          this.expressionMap.mainAlias!.name
        );
        if (
          this.findOptions.loadEagerRelations !== false &&
          this.expressionMap.relationLoadStrategy === 'join'
        ) {
          this.buildEagerRelations(
            relations,
            typeof this.findOptions.select === 'object'
              ? (this.findOptions.select as FindOptionsSelect<ObjectLiteral>)
              : undefined,
            this.expressionMap.mainAlias!.metadata,
            this.expressionMap.mainAlias!.name
          );
        }
      }
      if (this.selects.length) {
        this.addSelect(this.selects);
      }

      if (this.findOptions.where) {
        this.conditions = this.buildWhere(
          this.findOptions.where,
          this.expressionMap.mainAlias!.metadata,
          this.expressionMap.mainAlias!.name
        );

        if (this.conditions.length)
          this.andWhere(
            this.conditions.substr(0, 1) !== '('
              ? '(' + this.conditions + ')'
              : this.conditions
          ); // temporary and where and braces
      }

      if (this.findOptions.order) {
        this.buildOrder(
          this.findOptions.order,
          this.expressionMap.mainAlias!.metadata,
          this.expressionMap.mainAlias!.name
        );
      }

      // apply joins
      if (this.joins.length) {
        this.joins.forEach((join) => {
          if (join.select && !join.selection) {
            // if (join.selection) {
            //
            // } else {
            if (join.type === 'inner') {
              this.innerJoinAndSelect(
                `${join.parentAlias}.${join.relationMetadata.propertyPath}`,
                join.alias
              );
            } else {
              this.leftJoinAndSelect(
                `${join.parentAlias}.${join.relationMetadata.propertyPath}`,
                join.alias
              );
            }
            // }
          } else {
            if (join.type === 'inner') {
              this.innerJoin(
                `${join.parentAlias}.${join.relationMetadata.propertyPath}`,
                join.alias
              );
            } else {
              this.leftJoin(
                `${join.parentAlias}.${join.relationMetadata.propertyPath}`,
                join.alias
              );
            }
          }

          // if (join.select) {
          //     if (this.findOptions.loadEagerRelations !== false) {
          //         FindOptionsUtils.joinEagerRelations(
          //             this,
          //             join.alias,
          //             join.relationMetadata.inverseEntityMetadata
          //         );
          //     }
          // }
        });
      }

      // if (this.conditions.length) {
      //     this.where(this.conditions.join(" AND "));
      // }

      // apply offset
      if (this.findOptions.skip !== undefined) {
        // if (this.findOptions.options && this.findOptions.options.pagination === false) {
        //     this.offset(this.findOptions.skip);
        // } else {
        this.skip(this.findOptions.skip);
        // }
      }

      // apply limit
      if (this.findOptions.take !== undefined) {
        // if (this.findOptions.options && this.findOptions.options.pagination === false) {
        //     this.limit(this.findOptions.take);
        // } else {
        this.take(this.findOptions.take);
        // }
      }

      // apply caching options
      if (typeof this.findOptions.cache === 'number') {
        this.cache(this.findOptions.cache);
      } else if (typeof this.findOptions.cache === 'boolean') {
        this.cache(this.findOptions.cache);
      } else if (typeof this.findOptions.cache === 'object') {
        this.cache(
          this.findOptions.cache.id,
          this.findOptions.cache.milliseconds
        );
      }

      if (this.findOptions.join) {
        if (this.findOptions.join.leftJoin)
          Object.keys(this.findOptions.join.leftJoin).forEach((key) => {
            this.leftJoin(this.findOptions.join!.leftJoin![key] as string, key);
          });

        if (this.findOptions.join.innerJoin)
          Object.keys(this.findOptions.join.innerJoin).forEach((key) => {
            this.innerJoin(
              this.findOptions.join!.innerJoin![key] as string,
              key
            );
          });

        if (this.findOptions.join.leftJoinAndSelect)
          Object.keys(this.findOptions.join.leftJoinAndSelect).forEach(
            (key) => {
              this.leftJoinAndSelect(
                this.findOptions.join!.leftJoinAndSelect![key] as string,
                key
              );
            }
          );

        if (this.findOptions.join.innerJoinAndSelect)
          Object.keys(this.findOptions.join.innerJoinAndSelect).forEach(
            (key) => {
              this.innerJoinAndSelect(
                this.findOptions.join!.innerJoinAndSelect![key] as string,
                key
              );
            }
          );
      }

      if (this.findOptions.lock) {
        if (this.findOptions.lock.mode === 'optimistic') {
          this.setLock(
            this.findOptions.lock.mode,
            this.findOptions.lock.version
          );
        } else if (
          this.findOptions.lock.mode === 'pessimistic_read' ||
          this.findOptions.lock.mode === 'pessimistic_write' ||
          this.findOptions.lock.mode === 'dirty_read' ||
          this.findOptions.lock.mode === 'pessimistic_partial_write' ||
          this.findOptions.lock.mode === 'pessimistic_write_or_fail' ||
          this.findOptions.lock.mode === 'for_no_key_update' ||
          this.findOptions.lock.mode === 'for_key_share'
        ) {
          const tableNames = this.findOptions.lock.tables
            ? this.findOptions.lock.tables.map((table) => {
                const tableAlias = this.expressionMap.aliases.find((alias) => {
                  return alias.metadata.tableNameWithoutPrefix === table;
                });
                if (!tableAlias) {
                  throw new TypeORMError(
                    `"${table}" is not part of this query`
                  );
                }
                return this.escape(tableAlias.name);
              })
            : undefined;
          this.setLock(this.findOptions.lock.mode, undefined, tableNames);

          if (this.findOptions.lock.onLocked) {
            this.setOnLocked(this.findOptions.lock.onLocked);
          }
        }
      }

      if (this.findOptions.loadRelationIds === true) {
        this.loadAllRelationIds();
      } else if (typeof this.findOptions.loadRelationIds === 'object') {
        this.loadAllRelationIds(
          this.findOptions
            .loadRelationIds as typeof this.findOptions.loadRelationIds
        );
      }

      if (this.findOptions.loadEagerRelations !== false) {
        FindOptionsUtils.joinEagerRelations(
          this as unknown as SelectQueryBuilder<ObjectLiteral>,
          this.expressionMap.mainAlias!.name,
          this.expressionMap.mainAlias!.metadata
        );
      }

      if (this.findOptions.transaction === true) {
        this.expressionMap.useTransaction = true;
      }

      // if (this.orderBys.length) {
      //     this.orderBys.forEach(orderBy => {
      //         this.addOrderBy(orderBy.alias, orderBy.direction, orderBy.nulls);
      //     });
      // }

      // todo
      // if (this.options.options && this.options.options.eagerRelations) {
      //     this.queryBuilder
      // }

      // todo
      // if (this.findOptions.options && this.findOptions.listeners === false) {
      //     this.callListeners(false);
      // }
    }
  }

  public concatRelationMetadata(relationMetadata: RelationMetadata): void {
    this.relationMetadatas.push(relationMetadata);
  }

  /**
   * Executes sql generated by query builder and returns object with raw results and entities created from them.
   */
  protected async executeEntitiesAndRawResults(
    queryRunner: QueryRunner
  ): Promise<{ entities: Array<Entity>; raw: Array<unknown> }> {
    if (!this.expressionMap.mainAlias)
      throw new TypeORMError(
        `Alias is not set. Use "from" method to set an alias.`
      );

    if (
      (this.expressionMap.lockMode === 'pessimistic_read' ||
        this.expressionMap.lockMode === 'pessimistic_write' ||
        this.expressionMap.lockMode === 'pessimistic_partial_write' ||
        this.expressionMap.lockMode === 'pessimistic_write_or_fail' ||
        this.expressionMap.lockMode === 'for_no_key_update' ||
        this.expressionMap.lockMode === 'for_key_share') &&
      !queryRunner.isTransactionActive
    )
      throw new PessimisticLockTransactionRequiredError();

    if (this.expressionMap.lockMode === 'optimistic') {
      const metadata = this.expressionMap.mainAlias.metadata;
      if (!metadata.versionColumn && !metadata.updateDateColumn)
        throw new NoVersionOrUpdateDateColumnError(metadata.name);
    }

    const relationIdLoader = new RelationIdLoader(
      this.connection,
      queryRunner,
      this.expressionMap.relationIdAttributes
    );
    const relationCountLoader = new RelationCountLoader(
      this.connection,
      queryRunner,
      this.expressionMap.relationCountAttributes
    );
    const relationIdMetadataTransformer =
      new RelationIdMetadataToAttributeTransformer(this.expressionMap);
    relationIdMetadataTransformer.transform();
    const relationCountMetadataTransformer =
      new RelationCountMetadataToAttributeTransformer(this.expressionMap);
    relationCountMetadataTransformer.transform();

    let rawResults: Array<unknown> = [],
      entities: Array<unknown> = [];

    // for pagination enabled (e.g. skip and take) its much more complicated - its a special process
    // where we make two queries to find the data we need
    // first query find ids in skip and take range
    // and second query loads the actual data in given ids range
    if (
      (this.expressionMap.skip || this.expressionMap.take) &&
      this.expressionMap.joinAttributes.length > 0
    ) {
      // we are skipping order by here because its not working in subqueries anyway
      // to make order by working we need to apply it on a distinct query
      const [selects, orderBys] =
        this.createOrderByCombinedWithSelectExpression('distinctAlias');
      const metadata = this.expressionMap.mainAlias.metadata;
      const mainAliasName = this.expressionMap.mainAlias.name;

      const querySelects = metadata.primaryColumns.map((primaryColumn) => {
        const distinctAlias = this.escape('distinctAlias');
        const columnAlias = this.escape(
          DriverUtils.buildAlias(
            this.connection.driver,
            undefined,
            mainAliasName,
            primaryColumn.databaseName
          )
        );
        if (!orderBys[columnAlias])
          // make sure we aren't overriding user-defined order in inverse direction
          orderBys[columnAlias] = 'ASC';

        const alias = DriverUtils.buildAlias(
          this.connection.driver,
          undefined,
          'ids_' + mainAliasName,
          primaryColumn.databaseName
        );

        return `${distinctAlias}.${columnAlias} AS ${this.escape(alias)}`;
      });

      const originalQuery = this.clone() as SelectQueryBuilder<Entity>;

      // preserve original timeTravel value since we set it to "false" in subquery
      // Note: originalQueryTimeTravel is not used in this version

      rawResults = await new SelectQueryBuilder(this.connection, queryRunner)
        .select(`DISTINCT ${querySelects.join(', ')}`)
        .addSelect(selects)
        .from(
          `(${(originalQuery as SelectQueryBuilder<Entity>)
            .orderBy()
            .timeTravelQuery() // set it to "false" since time travel clause must appear at the very end and applies to the entire SELECT clause.
            .getQuery()})`,
          'distinctAlias'
        )
        .timeTravelQuery()
        .offset(this.expressionMap.skip)
        .limit(this.expressionMap.take)
        .orderBy(orderBys)
        .cache(
          this.expressionMap.cache && this.expressionMap.cacheId
            ? `${this.expressionMap.cacheId}-pagination`
            : this.expressionMap.cache,
          this.expressionMap.cacheDuration
        )
        .setParameters(this.getParameters())
        .setNativeParameters(this.expressionMap.nativeParameters)
        .getRawMany();

      if (rawResults.length > 0) {
        let condition = '';
        const parameters: ObjectLiteral = {};
        if (metadata.hasMultiplePrimaryKeys) {
          condition = rawResults
            .map((result, index) => {
              return metadata.primaryColumns
                .map((primaryColumn) => {
                  const paramKey = `orm_distinct_ids_${index}_${primaryColumn.databaseName}`;
                  const paramKeyResult = DriverUtils.buildAlias(
                    this.connection.driver,
                    undefined,
                    'ids_' + mainAliasName,
                    primaryColumn.databaseName
                  );
                  parameters[paramKey] = (result as Record<string, unknown>)[
                    paramKeyResult
                  ];
                  return `${mainAliasName}.${primaryColumn.propertyPath}=:${paramKey}`;
                })
                .join(' AND ');
            })
            .join(' OR ');
        } else {
          const alias = DriverUtils.buildAlias(
            this.connection.driver,
            undefined,
            'ids_' + mainAliasName,
            metadata.primaryColumns[0]!.databaseName!
          );

          const ids = rawResults.map((result) => {
            return (result as Record<string, unknown>)[alias];
          });
          const areAllNumbers = ids.every(
            (id: unknown) => typeof id === 'number'
          );
          if (areAllNumbers) {
            // fixes #190. if all numbers then its safe to perform query without parameter
            condition = `${mainAliasName}.${
              metadata.primaryColumns[0]?.propertyPath
            } IN (${ids.join(', ')})`;
          } else {
            parameters['orm_distinct_ids'] = ids;
            condition =
              mainAliasName +
              '.' +
              metadata.primaryColumns[0]?.propertyPath +
              ' IN (:...orm_distinct_ids)';
          }
        }
        rawResults = await (this.clone() as SelectQueryBuilder<Entity>)
          .mergeExpressionMap({
            extraAppendedAndWhereCondition: condition,
          })
          .setParameters(parameters)
          .loadRawResults(queryRunner);
      }
    } else {
      rawResults = await this.loadRawResults(queryRunner);
    }

    if (rawResults.length > 0) {
      // transform raw results into entities
      const rawRelationIdResults = await relationIdLoader.load(rawResults);
      const rawRelationCountResults =
        await relationCountLoader.load(rawResults);
      const transformer = new RawSqlResultsToEntityTransformer(
        this.expressionMap,
        this.connection.driver,
        rawRelationIdResults,
        rawRelationCountResults,
        this.queryRunner
      );
      entities = transformer.transform(
        rawResults,
        this.expressionMap.mainAlias!
      ) as Array<Entity>;

      // broadcast all "after load" events
      if (
        this.expressionMap.callListeners === true &&
        this.expressionMap.mainAlias.hasMetadata
      ) {
        await queryRunner.broadcaster.broadcast(
          'Load',
          this.expressionMap.mainAlias.metadata,
          entities as Array<ObjectLiteral>
        );
      }
    }

    if (this.expressionMap.relationLoadStrategy === 'query') {
      const queryStrategyRelationIdLoader = new QueryStrategyRelationIdLoader(
        this.connection,
        queryRunner
      );

      await Promise.all(
        this.relationMetadatas.map(async (relation) => {
          const relationTarget = relation.inverseEntityMetadata.target;
          const relationAlias = relation.inverseEntityMetadata.targetName;

          const select = Array.isArray(this.findOptions.select)
            ? OrmUtils.propertyPathsToTruthyObject(
                this.findOptions.select as Array<string>
              )
            : this.findOptions.select;
          const relations = Array.isArray(this.findOptions.relations)
            ? OrmUtils.propertyPathsToTruthyObject(this.findOptions.relations)
            : this.findOptions.relations;

          const queryBuilder = (
            this.createQueryBuilder(
              queryRunner
            ) as SelectQueryBuilder<ObjectLiteral>
          )
            .select(relationAlias)
            .from(relationTarget, relationAlias)
            .setFindOptions({
              select: select
                ? (OrmUtils.deepValue(
                    select,
                    relation.propertyPath
                  ) as FindOptionsSelect<ObjectLiteral>)
                : undefined,
              order: this.findOptions.order
                ? (OrmUtils.deepValue(
                    this.findOptions.order,
                    relation.propertyPath
                  ) as FindOptionsOrder<ObjectLiteral>)
                : undefined,
              relations: relations
                ? (OrmUtils.deepValue(
                    relations,
                    relation.propertyPath
                  ) as FindOptionsRelations<ObjectLiteral>)
                : undefined,
              withDeleted: this.findOptions.withDeleted,
              relationLoadStrategy: this.findOptions.relationLoadStrategy,
            });
          if (entities.length > 0) {
            const relatedEntityGroups: Array<{
              entity: ObjectLiteral;
              related?: ObjectLiteral | Array<ObjectLiteral> | undefined;
            }> =
              await queryStrategyRelationIdLoader.loadManyToManyRelationIdsAndGroup<
                ObjectLiteral,
                ObjectLiteral
              >(
                relation,
                entities as Array<ObjectLiteral>,
                undefined,
                queryBuilder
              );
            entities.forEach((entity) => {
              const relatedEntityGroup = relatedEntityGroups.find(
                (group) => group.entity === entity
              );
              if (relatedEntityGroup) {
                const value =
                  relatedEntityGroup.related === undefined
                    ? null
                    : relatedEntityGroup.related;
                relation.setEntityValue(entity as ObjectLiteral, value);
              }
            });
          }
        })
      );
    }

    return {
      raw: rawResults,
      entities: entities as Array<Entity>,
    };
  }

  protected createOrderByCombinedWithSelectExpression(
    parentAlias: string
  ): [string, OrderByCondition] {
    // if table has a default order then apply it
    const orderBys = this.expressionMap.allOrderBys;
    const selectString = Object.keys(orderBys)
      .map((orderCriteria) => {
        if (orderCriteria.indexOf('.') !== -1) {
          const criteriaParts = orderCriteria.split('.');
          const aliasName = criteriaParts[0]!;
          const propertyPath = criteriaParts.slice(1).join('.');
          const alias = this.expressionMap.findAliasByName(aliasName);
          const column =
            alias.metadata!.findColumnWithPropertyPath(propertyPath);
          const parentAliasNonNull = parentAlias!;
          const databaseNameNonNull = column!.databaseName! as string;
          const builtAlias = DriverUtils.buildAlias(
            this.connection.driver,
            undefined,
            aliasName,
            databaseNameNonNull
          ) as string;
          return (
            this.escape(parentAliasNonNull) + '.' + this.escape(builtAlias)
          );
        } else {
          if (
            this.expressionMap.selects.find(
              (select) =>
                select.selection === orderCriteria ||
                select.aliasName === orderCriteria
            )
          ) {
            const parentAliasNonNull = parentAlias!;
            const orderCriteriaNonNull = orderCriteria! as string;
            return (
              this.escape(parentAliasNonNull) +
              '.' +
              this.escape(orderCriteriaNonNull)
            );
          }

          return '';
        }
      })
      .join(', ');

    const orderByObject: Record<string, unknown> = {};
    Object.keys(orderBys).forEach((orderCriteria) => {
      if (orderCriteria.indexOf('.') !== -1) {
        const criteriaParts = orderCriteria.split('.');
        const aliasName = criteriaParts[0]!;
        const propertyPath = criteriaParts.slice(1).join('.');
        const alias = this.expressionMap.findAliasByName(aliasName);
        const column = alias.metadata!.findColumnWithPropertyPath(propertyPath);
        const parentAliasNonNull = parentAlias!;
        const databaseNameNonNull = column!.databaseName! as string;
        const builtAlias = DriverUtils.buildAlias(
          this.connection.driver,
          undefined,
          aliasName,
          databaseNameNonNull
        ) as string;
        orderByObject[
          this.escape(parentAliasNonNull) + '.' + this.escape(builtAlias)
        ] = orderBys[orderCriteria];
      } else {
        if (
          this.expressionMap.selects.find(
            (select) =>
              select.selection === orderCriteria ||
              select.aliasName === orderCriteria
          )
        ) {
          orderByObject[
            this.escape(parentAlias) + '.' + this.escape(orderCriteria!)
          ] = orderBys[orderCriteria];
        } else {
          orderByObject[orderCriteria] = orderBys[orderCriteria];
        }
      }
    });

    return [selectString, orderByObject as OrderByCondition];
  }

  /**
   * Loads raw results from the database.
   */
  protected async loadRawResults(
    queryRunner: QueryRunner
  ): Promise<Array<unknown>> {
    const [sql, parameters] = this.getQueryAndParameters();
    const queryId =
      sql +
      ' -- PARAMETERS: ' +
      JSON.stringify(parameters, (_, value) =>
        typeof value === 'bigint'
          ? value.toString()
          : (value as string | number | Date)
      );
    const cacheOptions =
      typeof this.connection.options.cache === 'object'
        ? this.connection.options.cache
        : {};
    let savedQueryResultCacheOptions: QueryResultCacheOptions | undefined =
      undefined;
    const isCachingEnabled =
      // Caching is enabled globally and isn't disabled locally.
      (cacheOptions.alwaysEnabled && this.expressionMap.cache !== false) ||
      // ...or it's enabled locally explicitly.
      this.expressionMap.cache === true;
    let cacheError = false;
    if (this.connection.queryResultCache && isCachingEnabled) {
      try {
        savedQueryResultCacheOptions =
          (await this.connection.queryResultCache.getFromCache(
            {
              identifier: this.expressionMap.cacheId,
              query: queryId,
              duration:
                this.expressionMap.cacheDuration ||
                cacheOptions.duration ||
                1000,
            },
            queryRunner
          )) as QueryResultCacheOptions | undefined;
        if (
          savedQueryResultCacheOptions &&
          !this.connection.queryResultCache.isExpired(
            savedQueryResultCacheOptions
          )
        ) {
          return JSON.parse(
            savedQueryResultCacheOptions.result! as string
          ) as Array<Record<string, unknown>>;
        }
      } catch (error) {
        if (!cacheOptions.ignoreErrors) {
          throw error;
        }
        cacheError = true;
      }
    }

    const results = await queryRunner.query(sql, parameters, true);

    if (!cacheError && this.connection.queryResultCache && isCachingEnabled) {
      try {
        await this.connection.queryResultCache.storeInCache(
          {
            identifier: this.expressionMap.cacheId,
            query: queryId,
            time: Date.now(),
            duration:
              this.expressionMap.cacheDuration || cacheOptions.duration || 1000,
            result: JSON.stringify(results.records),
          },
          savedQueryResultCacheOptions,
          queryRunner
        );
      } catch (error) {
        if (!cacheOptions.ignoreErrors) {
          throw error;
        }
      }
    }

    return results.records;
  }

  /**
   * Merges into expression map given expression map properties.
   */
  protected mergeExpressionMap(
    expressionMap: Partial<QueryExpressionMap>
  ): this {
    ObjectUtils.assign(this.expressionMap, expressionMap);
    return this;
  }

  /**
   * Normalizes a give number - converts to int if possible.
   */
  protected normalizeNumber(num: unknown): number | undefined {
    if (typeof num === 'number') return num;
    if (num === undefined || num === null) return undefined;
    return Number(num);
  }

  /**
   * Creates a query builder used to execute sql queries inside this query builder.
   */
  protected obtainQueryRunner(): QueryRunner {
    return (
      this.queryRunner ||
      this.connection.createQueryRunner(
        this.connection.defaultReplicationModeForReads()
      )
    );
  }

  protected buildSelect(
    select: FindOptionsSelect<ObjectLiteral>,
    metadata: EntityMetadata,
    alias: string,
    embedPrefix?: string
  ): void {
    for (const key in select) {
      if (select[key] === undefined || select[key] === false) continue;

      const propertyPath = embedPrefix ? embedPrefix + '.' + key : key;
      const column = metadata.findColumnWithPropertyPathStrict(propertyPath);
      const embed = metadata.findEmbeddedWithPropertyPath(propertyPath);
      const relation = metadata.findRelationWithPropertyPath(propertyPath);

      if (!embed && !column && !relation)
        throw new EntityPropertyNotFoundError(propertyPath, metadata);

      if (column) {
        this.selects.push(alias + '.' + propertyPath);
        // this.addSelect(alias + "." + propertyPath);
      } else if (embed) {
        this.buildSelect(
          select[key] as FindOptionsSelect<ObjectLiteral>,
          metadata,
          alias,
          propertyPath
        );

        // } else if (relation) {
        //     const joinAlias = alias + "_" + relation.propertyName;
        //     const existJoin = this.joins.find(join => join.alias === joinAlias);
        //     if (!existJoin) {
        //         this.joins.push({
        //             type: "left",
        //             select: false,
        //             alias: joinAlias,
        //             parentAlias: alias,
        //             relationMetadata: relation
        //         });
        //     }
        //     this.buildOrder(select[key] as FindOptionsOrder<any>, relation.inverseEntityMetadata, joinAlias);
      }
    }
  }

  protected buildRelations(
    relations: FindOptionsRelations<ObjectLiteral>,
    selection: FindOptionsSelect<ObjectLiteral> | undefined,
    metadata: EntityMetadata,
    alias: string,
    embedPrefix?: string
  ): void {
    if (!relations) return;

    Object.keys(relations).forEach((relationName) => {
      const relationValue = relations[
        relationName
      ] as unknown as FindOptionsRelations<ObjectLiteral>;
      const propertyPath = embedPrefix
        ? embedPrefix + '.' + relationName
        : relationName;
      const embed = metadata.findEmbeddedWithPropertyPath(propertyPath);
      const relation = metadata.findRelationWithPropertyPath(propertyPath);
      if (!embed && !relation)
        throw new EntityPropertyNotFoundError(propertyPath, metadata);

      if (embed) {
        this.buildRelations(
          relationValue,
          typeof selection === 'object'
            ? (OrmUtils.deepValue(
                selection,
                embed.propertyPath
              ) as FindOptionsSelect<ObjectLiteral>)
            : undefined,
          metadata,
          alias,
          propertyPath
        );
      } else if (relation) {
        let joinAlias = alias + '_' + propertyPath.replace('.', '_');
        joinAlias = DriverUtils.buildAlias(
          this.connection.driver,
          { joiner: '__' },
          alias,
          joinAlias
        );

        if (
          (typeof relationValue === 'boolean' && relationValue === true) ||
          typeof relationValue === 'object'
        ) {
          if (this.expressionMap.relationLoadStrategy === 'query') {
            this.concatRelationMetadata(relation);
          } else {
            // join
            this.joins.push({
              type: 'left',
              select: true,
              selection:
                selection && typeof relationValue[relationName] === 'object'
                  ? (relationValue[
                      relationName
                    ] as FindOptionsSelect<ObjectLiteral>)
                  : undefined,
              alias: joinAlias,
              parentAlias: alias,
              relationMetadata: relation,
            });

            if (selection && typeof relationValue[relationName] === 'object') {
              this.buildSelect(
                relationValue[relationName] as FindOptionsSelect<ObjectLiteral>,
                relation.inverseEntityMetadata,
                joinAlias
              );
            }
          }
        }

        if (
          typeof relationValue === 'object' &&
          this.expressionMap.relationLoadStrategy === 'join'
        ) {
          this.buildRelations(
            relationValue,
            typeof selection === 'object'
              ? (OrmUtils.deepValue(
                  selection,
                  relation.propertyPath
                ) as FindOptionsSelect<ObjectLiteral>)
              : undefined,
            relation.inverseEntityMetadata,
            joinAlias,
            undefined
          );
        }
      }
    });
  }

  protected buildEagerRelations(
    relations: FindOptionsRelations<ObjectLiteral>,
    selection: FindOptionsSelect<ObjectLiteral> | undefined,
    metadata: EntityMetadata,
    alias: string,
    embedPrefix?: string
  ): void {
    if (!relations) return;

    Object.keys(relations).forEach((relationName) => {
      const relationValue = relations[
        relationName
      ] as FindOptionsRelations<ObjectLiteral>;
      const propertyPath = embedPrefix
        ? embedPrefix + '.' + relationName
        : relationName;
      const embed = metadata.findEmbeddedWithPropertyPath(propertyPath);
      const relation = metadata.findRelationWithPropertyPath(propertyPath);
      if (!embed && !relation)
        throw new EntityPropertyNotFoundError(propertyPath, metadata);

      if (embed) {
        this.buildEagerRelations(
          relationValue,
          typeof selection === 'object'
            ? (OrmUtils.deepValue(
                selection,
                embed.propertyPath
              ) as FindOptionsSelect<ObjectLiteral>)
            : undefined,
          metadata,
          alias,
          propertyPath
        );
      } else if (relation) {
        let joinAlias = alias + '_' + propertyPath.replace('.', '_');
        joinAlias = DriverUtils.buildAlias(
          this.connection.driver,
          { joiner: '__' },
          alias,
          joinAlias
        );

        if (
          (typeof relationValue === 'boolean' && relationValue === true) ||
          typeof relationValue === 'object'
        ) {
          relation.inverseEntityMetadata.eagerRelations.forEach(
            (eagerRelation) => {
              let eagerRelationJoinAlias =
                joinAlias + '_' + eagerRelation.propertyPath.replace('.', '_');
              eagerRelationJoinAlias = DriverUtils.buildAlias(
                this.connection.driver,
                { joiner: '__' },
                joinAlias,
                eagerRelationJoinAlias
              );

              const existJoin = this.joins.find(
                (join) => join.alias === eagerRelationJoinAlias
              );
              if (!existJoin) {
                this.joins.push({
                  type: 'left',
                  select: true,
                  alias: eagerRelationJoinAlias,
                  parentAlias: joinAlias,
                  selection: undefined,
                  relationMetadata: eagerRelation,
                });
              }

              if (
                selection &&
                typeof relationValue[relationName] === 'object'
              ) {
                this.buildSelect(
                  relationValue[
                    relationName
                  ] as FindOptionsSelect<ObjectLiteral>,
                  relation.inverseEntityMetadata,
                  joinAlias
                );
              }
            }
          );
        }

        if (typeof relationValue === 'object') {
          this.buildEagerRelations(
            relationValue,
            typeof selection === 'object'
              ? (OrmUtils.deepValue(
                  selection,
                  relation.propertyPath
                ) as FindOptionsSelect<ObjectLiteral>)
              : undefined,
            relation.inverseEntityMetadata,
            joinAlias,
            undefined
          );
        }
      }
    });
  }

  protected buildOrder(
    orders: FindOptionsOrder<FindOptionsOrderValue>,
    metadata: EntityMetadata,
    alias: string,
    embedPrefix?: string
  ): void {
    for (const order of Object.entries(orders)) {
      if (order === undefined) continue;

      const propertyPath = embedPrefix
        ? embedPrefix + '.' + order[0]
        : order[0];
      const column = metadata.findColumnWithPropertyPathStrict(propertyPath);
      const embed = metadata.findEmbeddedWithPropertyPath(propertyPath);
      const relation = metadata.findRelationWithPropertyPath(propertyPath);

      if (!embed && !column && !relation)
        throw new EntityPropertyNotFoundError(propertyPath, metadata);

      if (column) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let direction =
          typeof order[1] === 'object'
            ? (order[1] as unknown as Record<string, string>).direction
            : order[1];
        direction =
          direction === 'DESC' || direction === 'desc' || direction === -1
            ? 'DESC'
            : 'ASC';
        let nulls =
          typeof order[1] === 'object'
            ? (order[1] as unknown as Record<string, string>).nulls
            : undefined;
        nulls =
          nulls?.toLowerCase() === 'first'
            ? 'NULLS FIRST'
            : nulls?.toLowerCase() === 'last'
              ? 'NULLS LAST'
              : undefined;

        const aliasPath = `${alias}.${propertyPath}`;
        // const selection = this.expressionMap.selects.find(
        //     (s) => s.selection === aliasPath,
        // )
        // if (selection) {
        //     // this is not building correctly now???
        //     aliasPath = this.escape(
        //         DriverUtils.buildAlias(
        //             this.connection.driver,
        //             undefined,
        //             alias,
        //             column.databaseName,
        //         ),
        //     )
        //     // selection.aliasName = aliasPath
        // } else {
        //     if (column.isVirtualProperty && column.query) {
        //         aliasPath = `(${column.query(alias)})`
        //     }
        // }

        // console.log("add sort", selection, aliasPath, direction, nulls)
        this.addOrderBy(
          aliasPath,
          direction as 'ASC' | 'DESC',
          nulls as 'NULLS FIRST' | 'NULLS LAST' | undefined
        );
        // this.orderBys.push({ alias: alias + "." + propertyPath, direction, nulls });
      } else if (embed) {
        this.buildOrder(
          order[1] as FindOptionsOrder<ObjectLiteral>,
          metadata,
          alias,
          propertyPath
        );
      } else if (relation) {
        let joinAlias = alias + '_' + propertyPath.replace('.', '_');
        joinAlias = DriverUtils.buildAlias(
          this.connection.driver,
          { joiner: '__' },
          alias,
          joinAlias
        );
        // console.log("joinAlias", joinAlias, joinAlias.length, this.driver.maxAliasLength)
        // todo: use expressionMap.joinAttributes, and create a new one using
        //  const joinAttribute = new JoinAttribute(this.connection, this.expressionMap);

        const existJoin = this.joins.find((join) => join.alias === joinAlias);
        if (!existJoin) {
          this.joins.push({
            type: 'left',
            select: false,
            alias: joinAlias,
            parentAlias: alias,
            selection: undefined,
            relationMetadata: relation,
          });
        }
        this.buildOrder(
          order[1] as FindOptionsOrder<ObjectLiteral>,
          relation.inverseEntityMetadata,
          joinAlias
        );
      }
    }
  }

  protected buildWhere(
    where:
      | Array<FindOptionsWhere<ObjectLiteral>>
      | FindOptionsWhere<ObjectLiteral>,
    metadata: EntityMetadata,
    alias: string,
    embedPrefix?: string
  ): string {
    let condition = '';
    // let parameterIndex = Object.keys(this.expressionMap.nativeParameters).length;
    if (Array.isArray(where)) {
      if (where.length) {
        condition = where
          .map((whereItem) => {
            return this.buildWhere(whereItem, metadata, alias, embedPrefix);
          })
          .filter((condition) => !!condition)
          .map((condition) => '(' + condition + ')')
          .join(' OR ');
      }
    } else {
      const andConditions: Array<string> = [];
      for (const key in where) {
        let parameterValue = where[key];

        const propertyPath = embedPrefix ? embedPrefix + '.' + key : key;
        const column = metadata.findColumnWithPropertyPathStrict(propertyPath);
        const embed = metadata.findEmbeddedWithPropertyPath(propertyPath);
        const relation = metadata.findRelationWithPropertyPath(propertyPath);

        if (!embed && !column && !relation) {
          throw new EntityPropertyNotFoundError(propertyPath, metadata);
        }

        if (parameterValue === undefined) {
          const undefinedBehavior =
            this.connection.options.invalidWhereValuesBehavior?.undefined ||
            'ignore';
          if (undefinedBehavior === 'throw') {
            throw new TypeORMError(
              `Undefined value encountered in property '${alias}.${key}' of a where condition. ` +
                `Set 'invalidWhereValuesBehavior.undefined' to 'ignore' in connection options to skip properties with undefined values.`
            );
          }
          continue;
        }

        if (parameterValue === null) {
          const nullBehavior =
            this.connection.options.invalidWhereValuesBehavior?.null ||
            'ignore';
          if (nullBehavior === 'ignore') {
            continue;
          } else if (nullBehavior === 'throw') {
            throw new TypeORMError(
              `Null value encountered in property '${alias}.${key}' of a where condition. ` +
                `To match with SQL NULL, the IsNull() operator must be used. ` +
                `Set 'invalidWhereValuesBehavior.null' to 'ignore' or 'sql-null' in connection options to skip or handle null values.`
            );
          }
          // 'sql-null' behavior continues to the next logic
        }

        if (column) {
          let aliasPath = `${alias}.${propertyPath}`;
          if (column.isVirtualProperty && column.query) {
            aliasPath = `(${column.query(this.escape(alias))})`;
          }

          if (parameterValue === null) {
            andConditions.push(`${aliasPath} IS NULL`);
            continue;
          }

          // const parameterName = alias + "_" + propertyPath.split(".").join("_") + "_" + parameterIndex;

          // todo: we need to handle other operators as well?
          if (InstanceChecker.isEqualOperator(where[key])) {
            parameterValue = where[key].value as FindOperator<unknown>;
          }

          if (column.transformer) {
            if (parameterValue instanceof FindOperator) {
              parameterValue.transformValue(column.transformer);
            } else {
              parameterValue = ApplyValueTransformers.transformTo(
                column.transformer,
                parameterValue
              ) as FindOperator<unknown>;
            }
          }

          andConditions.push(
            this.createWhereConditionExpression(
              this.getWherePredicateCondition(
                aliasPath,
                parameterValue as FindOperator<ObjectLiteral>
              )
            )
            // parameterValue.toSql(this.connection, aliasPath, parameters));
          );

          // this.conditions.push(`${alias}.${propertyPath} = :${paramName}`);
          // this.expressionMap.parameters[paramName] = where[key]; // todo: handle functions and other edge cases
        } else if (embed) {
          const condition = this.buildWhere(
            where[key] as FindOptionsWhere<ObjectLiteral>,
            metadata,
            alias,
            propertyPath
          );
          if (condition) andConditions.push(condition);
        } else if (relation) {
          if ((where[key] as FindOptionsWhere<ObjectLiteral>) === null) {
            const nullBehavior =
              this.connection.options.invalidWhereValuesBehavior?.null ||
              'ignore';
            if (nullBehavior === 'sql-null') {
              andConditions.push(`${alias}.${propertyPath} IS NULL`);
            } else if (nullBehavior === 'throw') {
              throw new TypeORMError(
                `Null value encountered in property '${alias}.${key}' of a where condition. ` +
                  `Set 'invalidWhereValuesBehavior.null' to 'ignore' or 'sql-null' in connection options to skip or handle null values.`
              );
            }
            // 'ignore' behavior falls through to continue
            continue;
          }

          // if all properties of where are undefined we don't need to join anything
          // this can happen when user defines map with conditional queries inside
          if (typeof where[key] === 'object') {
            const allAllUndefined = Object.keys(
              where[key] as FindOptionsWhere<ObjectLiteral>
            ).every(
              (k) =>
                (where[key] as FindOptionsWhere<ObjectLiteral>)[k] === undefined
            );
            if (allAllUndefined) {
              continue;
            }
          }

          if (InstanceChecker.isFindOperator(where[key])) {
            if (
              where[key].type === 'moreThan' ||
              where[key].type === 'lessThan' ||
              where[key].type === 'moreThanOrEqual' ||
              where[key].type === 'lessThanOrEqual'
            ) {
              let sqlOperator = '';
              if (where[key].type === 'moreThan') {
                sqlOperator = '>';
              } else if (where[key].type === 'lessThan') {
                sqlOperator = '<';
              } else if (where[key].type === 'moreThanOrEqual') {
                sqlOperator = '>=';
              } else if (where[key].type === 'lessThanOrEqual') {
                sqlOperator = '<=';
              }
              // basically relation count functionality
              const qb: QueryBuilder<ObjectLiteral> = this.subQuery();
              if (relation.isManyToManyOwner) {
                qb.select('COUNT(*)')
                  .from(relation.joinTableName, relation.joinTableName)
                  .where(
                    relation.joinColumns
                      .map((column) => {
                        return `${relation.joinTableName}.${
                          column.propertyName
                        } = ${alias}.${column.referencedColumn!.propertyName}`;
                      })
                      .join(' AND ')
                  );
              } else if (relation.isManyToManyNotOwner) {
                qb.select('COUNT(*)')
                  .from(
                    relation.inverseRelation!.joinTableName,
                    relation.inverseRelation!.joinTableName
                  )
                  .where(
                    relation
                      .inverseRelation!.inverseJoinColumns.map((column) => {
                        return `${relation.inverseRelation!.joinTableName}.${
                          column.propertyName
                        } = ${alias}.${column.referencedColumn!.propertyName}`;
                      })
                      .join(' AND ')
                  );
              } else if (relation.isOneToMany) {
                qb.select('COUNT(*)')
                  .from(
                    relation.inverseEntityMetadata.target,
                    relation.inverseEntityMetadata.tableName
                  )
                  .where(
                    relation
                      .inverseRelation!.joinColumns.map((column) => {
                        return `${relation.inverseEntityMetadata.tableName}.${
                          column.propertyName
                        } = ${alias}.${column.referencedColumn!.propertyName}`;
                      })
                      .join(' AND ')
                  );
              } else {
                throw new Error(
                  `This relation isn't supported by given find operator`
                );
              }
              // this
              //     .addSelect(qb.getSql(), relation.propertyAliasName + "_cnt")
              //     .andWhere(this.escape(relation.propertyAliasName + "_cnt") + " " + sqlOperator + " " + parseInt(where[key].value));
              this.andWhere(
                qb.getSql() +
                  ' ' +
                  sqlOperator +
                  ' ' +
                  parseInt(where[key].value as string)
              );
            } else {
              if (
                relation.isManyToOne ||
                (relation.isOneToOne && relation.isOneToOneOwner)
              ) {
                const aliasPath = `${alias}.${propertyPath}`;

                andConditions.push(
                  this.createWhereConditionExpression(
                    this.getWherePredicateCondition(
                      aliasPath,
                      where[key] as FindOperator<ObjectLiteral>
                    )
                  )
                );
              } else {
                throw new Error(
                  `This relation isn't supported by given find operator`
                );
              }
            }
          } else {
            // const joinAlias = alias + "_" + relation.propertyName;
            let joinAlias =
              alias + '_' + relation.propertyPath.replace('.', '_');
            joinAlias = DriverUtils.buildAlias(
              this.connection.driver,
              { joiner: '__' },
              alias,
              joinAlias
            );

            const existJoin = this.joins.find(
              (join) => join.alias === joinAlias
            );
            if (!existJoin) {
              this.joins.push({
                type: 'left',
                select: false,
                selection: undefined,
                alias: joinAlias,
                parentAlias: alias,
                relationMetadata: relation,
              });
            }

            const condition = this.buildWhere(
              where[key] as FindOptionsWhere<ObjectLiteral>,
              relation.inverseEntityMetadata,
              joinAlias
            );
            if (condition) {
              andConditions.push(condition);
              // parameterIndex = Object.keys(this.expressionMap.nativeParameters).length;
            }
          }
        }
      }
      condition = andConditions.length
        ? '(' + andConditions.join(') AND (') + ')'
        : andConditions.join(' AND ');
    }
    return condition.length ? '(' + condition + ')' : condition;
  }
}
