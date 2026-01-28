import oracledb from 'oracledb';
import pg from 'pg';
import { DataSource, QueryBuilder } from 'typeorm';
import type { OracleConnectionOptions } from 'typeorm/driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

import { OracleUtils } from '../adapters/oracle/oracle-utils.js';
import { PostgreUtils } from '../adapters/postgres/postgre-utils.js';
import { caseStrategyFactory } from '../case-strategy/case-strategy-factory.js';
import type {
  ICaseStratefyFactory,
  IDataBaseUtils,
  IEntityOptions,
  ILoggerModule,
  IMigrationOptions,
  TDbConfig,
} from '../types.js';
export class DataSourceInitializer {
  public readonly appDataSource: DataSource;
  protected dbUtilsInstance!: IDataBaseUtils<typeof this.dbConfig.type>;
  private caseSettings: ICaseStratefyFactory;
  /**
   * Constructor for the DataSourceInitializer class.
   *
   * @param dbConfig - database configuration
   * @param procedureObjectList - list of uses procedures
   * @param logger - logger
   * @param entity - entity configuration (optional)
   * @param migration - migration configuration (optional)
   */
  protected constructor(
    protected readonly dbConfig: TDbConfig,
    protected readonly procedureObjectList: Record<string, string>,
    protected readonly logger: ILoggerModule,
    protected readonly entity?: IEntityOptions,
    protected readonly migration?: IMigrationOptions,
  ) {
    this.caseSettings = caseStrategyFactory(
      this.dbConfig.outKeyTransformCase,
      // this.dbConfig.type,
    );
    const options: OracleConnectionOptions | PostgresConnectionOptions = {
      username: dbConfig.username,
      password: dbConfig.password,
      database: dbConfig.database,
      host: dbConfig.host,
      port: dbConfig.port,
      synchronize: this.entity?.isNeedEntitySync,
      logger: 'advanced-console',
      logging: true,
      poolSize: dbConfig.poolSize,
      maxQueryExecutionTime: dbConfig.callTimeout,
      namingStrategy: this.caseSettings.strategy,
      isolateWhereStatements: true,
      invalidWhereValuesBehavior: {
        null: 'sql-null',
        undefined: 'throw',
      },
      migrations: this.migration?.isNeedMigrationStart
        ? [this.migration.migrationPath]
        : [],
      entities: this.entity?.entityPath ? [this.entity.entityPath] : [],
      ...(dbConfig.type === 'postgres'
        ? this.getPostgresOptions()
        : this.getOracleOptions()),
    } as const;
    this.appDataSource = new DataSource(options);
  }

  /**
   * Initializes the data source with the provided configuration
   * and runs the database migrations if they are available and synchronization is needed
   * @returns {Promise<void>} - promise that resolves when the data source is initialized
   * @throws {Error} - error that occurs during the initialization process
   */
  protected async initDataSource(): Promise<void> {
    try {
      await this.appDataSource.initialize();
      if (
        this.migration &&
        this.migration.migrationPath !== '' &&
        (await this.appDataSource.showMigrations())
      )
        await this.appDataSource.runMigrations();
      this.initExecuteTypeormWithoutDoubleQuotes();
      this.logger.log('DataSource is initialized');
    } catch (error) {
      this.logger.error(
        `DataSource initialization error: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Initializes the database utils object based on the database type
   * and calls the registerFetchHandlerHook method if it is needed
   */
  protected initDbUtils(): void {
    this.dbUtilsInstance =
      this.dbConfig.type === 'postgres'
        ? new PostgreUtils(
            // this.clientConfigPostgres,
            this.appDataSource,
            this.logger,
          )
        : new OracleUtils(
            this.appDataSource,
            this.logger,
            this.dbConfig.cqn_config.port,
          );
    this.dbUtilsInstance.registerFetchHandlerHook({
      caseNativeStrategy: this.caseSettings.nativeStrategy,
      isNeedRegisterDefaultSerializers:
        this.dbConfig.isNeedRegisterDefaultSerializers,
    });
  }

  /**
   * This method is used to patch the QueryBuilder's replacePropertyNamesForTheWholeQuery
   * method to remove double quotes from the query. This is necessary because TypeORM
   * uses double quotes to escape column names, which are not necessary in Oracle and Postgres.
   * The method replaces the original method with a patched version that removes the
   * double quotes from the query.
   * @private
   */
  //TODO: Refactor in the future
  private initExecuteTypeormWithoutDoubleQuotes(): void {
    const queryBuilderPrototype =
      QueryBuilder.prototype as typeof QueryBuilder.prototype & {
        replacePropertyNamesForTheWholeQuery: (statement: string) => string;
      };

    if (
      typeof queryBuilderPrototype.replacePropertyNamesForTheWholeQuery ===
      'function'
    ) {
      const originalMethod =
        queryBuilderPrototype.replacePropertyNamesForTheWholeQuery;

      queryBuilderPrototype.replacePropertyNamesForTheWholeQuery = (
        statement: string,
      ): string =>
        originalMethod.call(this, statement).replace(/"([^"]+)"/g, '$1');
    }
  }
  /**
   * Returns the options for the Postgres data source connection.
   * These options are used to configure the data source connection.
   * @returns {PostgresConnectionOptions} - the options for the Postgres data source connection
   * @private
   */
  private getPostgresOptions(): PostgresConnectionOptions {
    return {
      type: 'postgres',
      driver: pg,
      parseInt8: true,
      installExtensions: true,
      uuidExtension: 'uuid-ossp',
      applicationName: this.dbConfig.appName,
    };
  }

  /**
   * Returns the options for the Oracle data source connection.
   * These options are used to configure the data source connection.
   * @returns {OracleConnectionOptions} - the options for the Oracle data source connection
   * @private
   */
  private getOracleOptions(): OracleConnectionOptions {
    const thickMode: OracleConnectionOptions['thickMode'] = this.dbConfig
      .libraryPath
      ? { libDir: this.dbConfig.libraryPath }
      : false;
    // console.log(thickMode);
    return {
      type: 'oracle',
      driver: oracledb,
      serviceName: this.dbConfig.database,
      thickMode: thickMode,
    };
  }
}
