import type { BaseDataSourceOptions } from '../data-source/BaseDataSourceOptions.js';
import { DataSource } from '../data-source/DataSource.js';
import type { Driver } from '../driver/Driver.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';
import { Table } from '../schema-builder/table/Table.js';

import type {
  QueryResultCache,
  QueryResultCacheOptions,
} from './cache.types.js';

export class DbQueryResultCache implements QueryResultCache {
  private cacheTableNameDefault = 'query-result-cache';
  private queryResultCacheTable: string;
  private driver: Driver;
  private options: BaseDataSourceOptions;
  private queryResultCacheDatabase?: string;
  private queryResultCacheSchema?: string;

  /**
   * Creates a new instance of DbQueryResultCache.
   * @param connection The DataSource that owns this cache.
   * The cache table name is determined by the following rules:
   * - If cache options are provided and they include a tableName,
   *   then that tableName is used.
   * - Otherwise, 'query-result-cache' is used as the default table name.
   * The cache database and schema are determined by the connection's database and schema.
   */
  public constructor(private connection: DataSource) {
    this.driver = connection.driver;
    this.options = this.driver.options;
    const database = this.driver.database;
    const cacheTableName =
      this.options.cache && typeof this.options.cache === 'object'
        ? (this.options.cache.tableName ?? this.cacheTableNameDefault)
        : this.cacheTableNameDefault;

    this.queryResultCacheDatabase = database;
    this.queryResultCacheSchema = this.driver.schema;
    this.queryResultCacheTable = this.connection.driver.buildTableName(
      cacheTableName,
      this.driver.schema,
      database
    );
  }

  public async synchronize(queryRunner?: QueryRunner): Promise<void> {
    queryRunner = this.getQueryRunner(queryRunner);
    const tableExist = await queryRunner.hasTable(this.queryResultCacheTable);
    if (tableExist) return;

    await queryRunner.createTable(
      new Table({
        database: this.queryResultCacheDatabase,
        schema: this.queryResultCacheSchema,
        name: this.queryResultCacheTable,
        columns: [
          {
            name: 'id',
            isPrimary: true,
            isNullable: false,
            type: this.driver.normalizeType({
              type: this.driver.mappedDataTypes.cacheId,
            }),
            generationStrategy: 'increment',
            isGenerated: true,
          },
          {
            name: 'identifier',
            type: this.driver.normalizeType({
              type: this.driver.mappedDataTypes.cacheIdentifier,
            }),
            isNullable: true,
          },
          {
            name: 'time',
            type: this.driver.normalizeType({
              type: this.driver.mappedDataTypes.cacheTime,
            }),
            isPrimary: false,
            isNullable: false,
          },
          {
            name: 'duration',
            type: this.driver.normalizeType({
              type: this.driver.mappedDataTypes.cacheDuration,
            }),
            isPrimary: false,
            isNullable: false,
          },
          {
            name: 'query',
            type: this.driver.normalizeType({
              type: this.driver.mappedDataTypes.cacheQuery,
            }),
            isPrimary: false,
            isNullable: false,
          },
          {
            name: 'result',
            type: this.driver.normalizeType({
              type: this.driver.mappedDataTypes.cacheResult,
            }),
            isNullable: false,
          },
        ],
      })
    );
  }

  public getFromCache(
    options: QueryResultCacheOptions,
    queryRunner?: QueryRunner
  ): Promise<QueryResultCacheOptions | undefined> {
    queryRunner = this.getQueryRunner(queryRunner);
    const qb = this.connection
      .createQueryBuilder(queryRunner)
      .select()
      .from(this.queryResultCacheTable, 'cache');

    if (options.identifier) {
      return qb
        .where(`${qb.escape('cache')}.${qb.escape('identifier')} = :identifier`)
        .setParameters({
          identifier:
            this.connection.driver.options.type === 'mssql'
              ? new MssqlParameter(options.identifier, 'nvarchar')
              : options.identifier,
        })
        .cache(false)
        .getRawOne();
    } else if (options.query) {
      if (this.connection.driver.options.type === 'oracle') {
        return qb
          .where(
            `dbms_lob.compare(${qb.escape('cache')}.${qb.escape(
              'query'
            )}, :query) = 0`,
            { query: options.query }
          )
          .cache(false)
          .getRawOne();
      }

      return qb
        .where(`${qb.escape('cache')}.${qb.escape('query')} = :query`)
        .setParameters({
          query:
            this.connection.driver.options.type === 'mssql'
              ? new MssqlParameter(options.query, 'nvarchar')
              : options.query,
        })
        .cache(false)
        .getRawOne();
    }

    return Promise.resolve(undefined);
  }

  public isExpired(savedCache: QueryResultCacheOptions): boolean {
    const duration =
      typeof savedCache.duration === 'string'
        ? parseInt(savedCache.duration)
        : savedCache.duration;
    return (
      (typeof savedCache.time === 'string'
        ? parseInt(savedCache.time)
        : savedCache.time)! +
        duration <
      Date.now()
    );
  }

  public async storeInCache(
    savedCache: QueryResultCacheOptions | undefined,
    queryRunner?: QueryRunner
  ): Promise<void> {
    const shouldCreateQueryRunner =
      !queryRunner || queryRunner?.getReplicationMode() === 'slave';

    if (shouldCreateQueryRunner) {
      queryRunner = this.connection.createQueryRunner('slave');
    }
    if (savedCache && savedCache.identifier) {
      // if exist then update
      const qb = queryRunner.manager
        .createQueryBuilder()
        .update(this.queryResultCacheTable)
        .set(insertedValues);

      qb.where(`${qb.escape('identifier')} = :condition`, {
        condition: insertedValues.identifier,
      });
      await qb.execute();
    } else if (savedCache && savedCache.query) {
      const qb = queryRunner.manager
        .createQueryBuilder()
        .update(this.queryResultCacheTable)
        .set(insertedValues);

      if (this.connection.driver.options.type === 'oracle') {
        qb.where(`dbms_lob.compare("query", :condition) = 0`, {
          condition: insertedValues.query,
        });
      } else {
        qb.where(`${qb.escape('query')} = :condition`, {
          condition: insertedValues.query,
        });
      }

      await qb.execute();
    } else {
      // otherwise insert
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(this.queryResultCacheTable)
        .values(insertedValues)
        .execute();
    }
    if (shouldCreateQueryRunner) {
      await queryRunner.release();
    }
  }

  public async clearCacheTable(queryRunner: QueryRunner): Promise<void> {
    return this.getQueryRunner(queryRunner).clearTable(
      this.queryResultCacheTable
    );
  }

  public async removeCacheData(
    identifiers: Array<string>,
    queryRunner?: QueryRunner
  ): Promise<void> {
    const _queryRunner: QueryRunner = queryRunner ?? this.getQueryRunner();
    await Promise.all(
      identifiers.map((identifier) => {
        const qb = _queryRunner.manager.createQueryBuilder();
        return qb
          .delete()
          .from(this.queryResultCacheTable)
          .where(`${qb.escape('identifier')} = :identifier`, {
            identifier,
          })
          .execute();
      })
    );

    if (!queryRunner) {
      await _queryRunner.release();
    }
  }
  private getQueryRunner(queryRunner?: QueryRunner): QueryRunner {
    if (queryRunner) return queryRunner;
    return this.connection.createQueryRunner();
  }
}
