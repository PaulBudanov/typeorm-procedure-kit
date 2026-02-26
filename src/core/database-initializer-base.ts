import oracledb from 'oracledb';
import pg from 'pg';

import { OracleAdapter } from '../adapters/oracle/oracle-adapter.js';
import { PostgreAdapter } from '../adapters/postgres/postgre-adapter.js';
import { CaseStrategyFactory } from '../case-strategy/case-strategy-factory.js';
import { DataSource } from '../typeorm/data-source/DataSource.js';
import type { OracleConnectionOptions } from '../typeorm/driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { DataSourceOptions } from '../typeorm/index.js';
import type {
  IRegisteredFetchHandlerOptions,
  TAdapterUtilsClassTypes,
} from '../types/adapter.types.js';
import type {
  IDatabaseCredentials,
  IEntityOptions,
  IMigrationOptions,
  IPostgresDbConfig,
  TDbConfig,
  TOracleDbConfig,
} from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type { ICaseStratefyFactory } from '../types/strategy.types.js';
import { ServerError } from '../utils/server-error.js';

export class DatabaseInitializerBase {
  public readonly appDataSource: DataSource;
  public readonly databaseAdapter: TAdapterUtilsClassTypes;
  private readonly caseSettings: ICaseStratefyFactory;
  public constructor(
    public readonly dbConfig: TDbConfig,
    private readonly logger: ILoggerModule,
    private readonly entity?: IEntityOptions,
    private readonly migration?: IMigrationOptions
  ) {
    this.caseSettings = CaseStrategyFactory.caseStrategyFactory(
      this.dbConfig.outKeyTransformCase
    );
    const options: DataSourceOptions = {
      ...this.configFactory(),
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
      isQuotingDisabled: false,
      migrations:
        this.migration?.migrationPath &&
        Array.isArray(this.migration.migrationPath)
          ? this.migration.migrationPath
          : [],
      entities:
        this.entity?.entityPath && Array.isArray(this.entity.entityPath)
          ? this.entity.entityPath
          : [],
    } as const;
    this.appDataSource = new DataSource(options);
    this.databaseAdapter = this.databaseAdapterFactory();
  }

  /**
   * Initializes the data source with the provided configuration
   * and runs the database migrations if they are available and synchronization is needed
   * @returns {Promise<void>} - promise that resolves when the data source is initialized
   * @throws {Error} - error that occurs during the initialization process
   */
  public async initDatabaseModule(): Promise<void> {
    try {
      await this.appDataSource.initialize();
      if (
        this.migration &&
        Array.isArray(this.migration.migrationPath) &&
        this.migration.migrationPath.length > 0
      ) {
        this.logger.log('Showing migrations...');
        await this.appDataSource.showMigrations();
        if (this.migration.isNeedMigrationStart) {
          this.logger.log('Running migrations...');
          await this.appDataSource.runMigrations();
        } else this.logger.log('Migrations skipped');
      }
      // this.initExecuteTypeormWithoutDoubleQuotes();
      this.logger.log('DataSource is initialized');
    } catch (error) {
      this.logger.error(
        `Database module initialization error: ${(error as Error).message}`
      );
      throw error;
    }
  }

  /**
   * This method is used to patch the QueryBuilder's replacePropertyNamesForTheWholeQuery
   * method to remove double quotes from the query. This is necessary because TypeORM
   * uses double quotes to escape column names, which are not necessary in Oracle and Postgres.
   * The method replaces the original method with a patched version that removes the
   * double quotes from the query.
   * @private
   */

  private configFactory(): PostgresConnectionOptions | OracleConnectionOptions {
    switch (this.dbConfig.type) {
      case 'postgres':
        return {
          ...this.getPostgresOptions(this.dbConfig),
          replication: {
            master: this.getPostgresOptions(
              this.dbConfig,
              this.dbConfig.master
            ),
            slaves:
              this.dbConfig.slaves?.map((slave) =>
                this.getPostgresOptions(
                  this.dbConfig as IPostgresDbConfig,
                  slave
                )
              ) ?? [],
          },
        };
      case 'oracle':
        return {
          ...this.getOracleOptions(this.dbConfig),
          replication: {
            master: this.getOracleOptions(this.dbConfig, this.dbConfig.master),
            slaves:
              this.dbConfig.slaves?.map((slave) =>
                this.getOracleOptions(this.dbConfig as TOracleDbConfig, slave)
              ) ?? [],
          },
        };
      default:
        throw new ServerError('Unknown database type!');
    }
  }

  private databaseAdapterFactory(): TAdapterUtilsClassTypes {
    const fetchHandlerOptions: IRegisteredFetchHandlerOptions = {
      isNeedRegisterDefaultSerializers:
        this.dbConfig.isNeedRegisterDefaultSerializers ?? false,
      caseNativeStrategy: this.caseSettings.nativeStrategy,
    };
    switch (this.dbConfig.type) {
      case 'postgres':
        return new PostgreAdapter(
          this.appDataSource,
          this.logger,
          fetchHandlerOptions
        );
      case 'oracle':
        return new OracleAdapter(
          this.appDataSource,
          this.logger,
          fetchHandlerOptions,
          this.dbConfig.cqnPort
        );
    }
  }
  /**
   * Returns the options for the Postgres data source connection.
   * These options are used to configure the data source connection.
   * @returns {PostgresConnectionOptions} - the options for the Postgres data source connection
   * @private
   */
  private getPostgresOptions(
    config: IPostgresDbConfig,
    credentials?: IDatabaseCredentials
  ): PostgresConnectionOptions {
    const defaultObject: PostgresConnectionOptions = {
      type: 'postgres',
      driver: pg,
      parseInt8: config.parseInt8AsBigInt,
      installExtensions: true,
      uuidExtension: 'uuid-ossp',
      applicationName: config.appName,
    };
    if (!credentials) return defaultObject;
    return {
      ...defaultObject,
      database: credentials.database,
      username: credentials.username,
      password: credentials.password,
      host: credentials.host,
      port: credentials.port,
    };
  }

  /**
   * Returns the options for the Oracle data source connection.
   * These options are used to configure the data source connection.
   * @returns {OracleConnectionOptions} - the options for the Oracle data source connection
   * @private
   */
  private getOracleOptions(
    config: TOracleDbConfig,
    credentials?: IDatabaseCredentials
  ): OracleConnectionOptions {
    const thickMode: OracleConnectionOptions['thickMode'] = config.libraryPath
      ? { libDir: config.libraryPath }
      : undefined;
    const defaultObject: OracleConnectionOptions = {
      type: 'oracle',
      driver: oracledb,
      serviceName: config.master.database,
      thickMode,
    };
    if (!credentials) return defaultObject;
    return {
      ...defaultObject,
      database: credentials.database,
      username: credentials.username,
      password: credentials.password,
      host: credentials.host,
      port: credentials.port,
      serviceName: credentials.database,
    };
  }
}
