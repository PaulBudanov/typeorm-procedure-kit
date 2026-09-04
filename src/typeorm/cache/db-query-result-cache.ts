import { formatDataSourceIdentifier } from '../data-source/IdentifierQuoting.js';
import { Table } from '../schema-builder/table/Table.js';

import type {
  QueryResultCache,
  QueryResultCacheOptions,
} from './cache.types.js';
import type { BaseDataSourceOptions } from '../data-source/BaseDataSourceOptions.js';
import type { DataSource } from '../data-source/DataSource.js';
import type { Driver } from '../driver/Driver.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';

export class DbQueryResultCache implements QueryResultCache {
  private readonly cacheTableNameDefault = 'query_result_cache';
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
   * - Otherwise, 'query_result_cache' is used as the default table name.
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
    this.queryResultCacheTable = this.driver.buildTableName(
      cacheTableName,
      this.driver.schema,
      database
    );
    this.validateCacheTablePath();
  }

  public async synchronize(queryRunner?: QueryRunner): Promise<void> {
    await this.withQueryRunner(
      queryRunner,
      async (activeQueryRunner) => {
        const tableExist = await activeQueryRunner.hasTable(
          this.queryResultCacheTable
        );
        if (tableExist) return;

        await activeQueryRunner.createTable(
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
      },
      true
    );
  }

  public async getFromCache(
    options: QueryResultCacheOptions,
    queryRunner?: QueryRunner
  ): Promise<QueryResultCacheOptions | undefined> {
    return this.withQueryRunner(queryRunner, async (activeQueryRunner) => {
      const cacheAlias = this.driver.escape('cache');
      const identifierColumn = this.formatPhysicalIdentifier('identifier');
      const queryColumn = this.formatPhysicalIdentifier('query');
      const qb = this.connection
        .createQueryBuilder(activeQueryRunner)
        .select()
        .from(this.queryResultCacheTable, 'cache');

      if (options.identifier) {
        return qb
          .where(`${cacheAlias}.${identifierColumn} = :identifier`)
          .setParameters({
            identifier: options.identifier,
          })
          .cache(false)
          .getRawOne();
      } else if (options.query) {
        if (this.driver.options.type === 'oracle') {
          return qb
            .where(
              `dbms_lob.compare(${cacheAlias}.${queryColumn}, :query) = 0`,
              { query: options.query }
            )
            .cache(false)
            .getRawOne();
        }

        return qb
          .where(`${cacheAlias}.${queryColumn} = :query`)
          .setParameters({
            query: options.query,
          })
          .cache(false)
          .getRawOne();
      }

      return undefined;
    });
  }

  public isExpired(savedCache: QueryResultCacheOptions): boolean {
    const parseCacheNumber = (value: unknown): number | undefined => {
      if (typeof value === 'string' && value.trim() === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const time = parseCacheNumber(savedCache.time);
    const duration = parseCacheNumber(savedCache.duration);
    if (time === undefined || duration === undefined) return true;

    const expiration = time + duration;
    return !Number.isFinite(expiration) || expiration < Date.now();
  }

  public async storeInCache(
    options: QueryResultCacheOptions,
    savedCache: QueryResultCacheOptions | undefined,
    queryRunner?: QueryRunner
  ): Promise<void> {
    await this.withQueryRunner(
      queryRunner,
      async (activeQueryRunner) => {
        const identifierColumn = this.formatPhysicalIdentifier('identifier');
        const queryColumn = this.formatPhysicalIdentifier('query');
        if (savedCache?.identifier) {
          const qb = activeQueryRunner.manager
            .createQueryBuilder()
            .update(this.queryResultCacheTable)
            .set(options);

          qb.where(`${identifierColumn} = :condition`, {
            condition: options.identifier,
          });
          await qb.execute();
        } else if (savedCache?.query) {
          const qb = activeQueryRunner.manager
            .createQueryBuilder()
            .update(this.queryResultCacheTable)
            .set(options);

          if (this.driver.options.type === 'oracle') {
            qb.where(`dbms_lob.compare(${queryColumn}, :condition) = 0`, {
              condition: options.query,
            });
          } else {
            qb.where(`${queryColumn} = :condition`, {
              condition: options.query,
            });
          }

          await qb.execute();
        } else {
          await activeQueryRunner.manager
            .createQueryBuilder()
            .insert()
            .into(this.queryResultCacheTable)
            .values(options)
            .execute();
        }
      },
      true
    );
  }

  public async clearCacheTable(queryRunner?: QueryRunner): Promise<void> {
    await this.withQueryRunner(
      queryRunner,
      (activeQueryRunner) =>
        activeQueryRunner.clearTable(this.queryResultCacheTable),
      true
    );
  }

  public async removeCacheData(
    identifiers: Array<string>,
    queryRunner?: QueryRunner
  ): Promise<void> {
    await this.withQueryRunner(
      queryRunner,
      async (activeQueryRunner) => {
        const identifierColumn = this.formatPhysicalIdentifier('identifier');
        for (const identifier of identifiers) {
          const qb = activeQueryRunner.manager.createQueryBuilder();
          await qb
            .delete()
            .from(this.queryResultCacheTable)
            .where(`${identifierColumn} = :identifier`, {
              identifier,
            })
            .execute();
        }
      },
      true
    );
  }

  private formatPhysicalIdentifier(identifier: string): string {
    return formatDataSourceIdentifier(identifier, this.connection);
  }

  private validateCacheTablePath(): void {
    for (const identifier of this.queryResultCacheTable.split('.')) {
      if (identifier !== '') this.formatPhysicalIdentifier(identifier);
    }
  }

  private async withQueryRunner<T>(
    queryRunner: QueryRunner | undefined,
    operation: (queryRunner: QueryRunner) => Promise<T>,
    requireMaster = false
  ): Promise<T> {
    this.validateCacheTablePath();
    const isOwnedQueryRunner =
      !queryRunner ||
      (requireMaster && queryRunner.getReplicationMode() !== 'master');
    const activeQueryRunner = isOwnedQueryRunner
      ? this.connection.createQueryRunner('master')
      : queryRunner;
    let operationResult:
      | { status: 'fulfilled'; value: T }
      | { status: 'rejected'; reason: unknown };

    try {
      operationResult = {
        status: 'fulfilled',
        value: await operation(activeQueryRunner),
      };
    } catch (error) {
      operationResult = { status: 'rejected', reason: error };
    }

    if (!isOwnedQueryRunner) {
      if (operationResult.status === 'rejected') throw operationResult.reason;
      return operationResult.value;
    }

    let releaseResult:
      | { status: 'fulfilled' }
      | { status: 'rejected'; reason: unknown };
    try {
      await activeQueryRunner.release();
      releaseResult = { status: 'fulfilled' };
    } catch (error) {
      releaseResult = { status: 'rejected', reason: error };
    }

    if (operationResult.status === 'rejected') {
      if (releaseResult.status === 'rejected') {
        throw new AggregateError(
          [operationResult.reason, releaseResult.reason],
          'Cache operation and query runner release both failed',
          { cause: operationResult.reason }
        );
      }
      throw operationResult.reason;
    }

    if (releaseResult.status === 'rejected') throw releaseResult.reason;
    return operationResult.value;
  }
}
