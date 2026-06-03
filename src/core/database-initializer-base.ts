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
  TDbConfig,
  TOracleDbConfig,
  TPostgresDbConfig,
} from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type { ICaseStrategyFactory } from '../types/strategy.types.js';
import { normalizeQueryTimeoutMs } from '../utils/query-timeout.js';
import { ServerError } from '../utils/server-error.js';

export class DatabaseInitializerBase {
  public readonly caseSettings: ICaseStrategyFactory;
  private appDataSourceInstance: DataSource | null = null;
  private databaseAdapterInstance: TAdapterUtilsClassTypes | null = null;
  public constructor(
    public readonly dbConfig: TDbConfig,
    private readonly logger: ILoggerModule,
    private readonly entity?: IEntityOptions,
    private readonly migration?: IMigrationOptions
  ) {
    this.caseSettings = CaseStrategyFactory.caseStrategyFactory(
      this.dbConfig.outKeyTransformCase
    );
  }

  public get appDataSource(): DataSource {
    if (!this.appDataSourceInstance)
      throw new ServerError('DataSource is not initialized');
    return this.appDataSourceInstance;
  }

  public get databaseAdapter(): TAdapterUtilsClassTypes {
    if (!this.databaseAdapterInstance)
      throw new ServerError('Database adapter is not initialized');
    return this.databaseAdapterInstance;
  }

  public get isDataSourceInitialized(): boolean {
    return this.appDataSourceInstance?.isInitialized ?? false;
  }

  /**
   * Initializes the data source with the provided configuration
   * and runs the database migrations if they are available and synchronization is needed
   * @returns {Promise<void>} - promise that resolves when the data source is initialized
   * @throws {Error} - error that occurs during the initialization process
   */
  public async initDatabaseModule(): Promise<void> {
    try {
      await this.initDataSource();
      if (!this.appDataSource.isInitialized)
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
   * Creates the TypeORM DataSource and the matching database adapter.
   *
   * The method is idempotent: if both objects already exist, it returns without
   * rebuilding them. Adapter fetch hooks are registered immediately after the
   * adapter is created so native query results use the configured serializers
   * and output-key casing.
   *
   * @throws {ServerError} - If the configured database type is not supported.
   */
  private async initDataSource(): Promise<void> {
    if (this.appDataSourceInstance && this.databaseAdapterInstance) return;

    const options: DataSourceOptions = {
      ...(await this.configFactory()),
      synchronize: this.entity?.isNeedEntitySync,
      logger: 'advanced-console',
      logging: false,
      poolSize: this.dbConfig.poolSize,
      maxQueryExecutionTime:
        this.dbConfig.maxQueryExecutionTime ?? this.dbConfig.callTimeout,
      namingStrategy: this.caseSettings.strategy,
      isolateWhereStatements: true,
      invalidWhereValuesBehavior: {
        null: 'sql-null',
        undefined: 'throw',
      },
      isQuotingDisabled: true,
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

    this.appDataSourceInstance = new DataSource(options);
    this.databaseAdapterInstance = await this.databaseAdapterFactory();
    this.databaseAdapterInstance.registerFetchHandlerHook();
  }

  private async configFactory(): Promise<
    PostgresConnectionOptions | OracleConnectionOptions
  > {
    switch (this.dbConfig.type) {
      case 'postgres': {
        const pg = (await import('pg')).default;
        return {
          ...this.getPostgresOptions(this.dbConfig, undefined, pg),
          replication: {
            master: this.getPostgresOptions(
              this.dbConfig,
              this.dbConfig.master,
              pg
            ),
            slaves:
              this.dbConfig.slaves?.map((slave) =>
                this.getPostgresOptions(
                  this.dbConfig as TPostgresDbConfig,
                  slave,
                  pg
                )
              ) ?? [],
          },
        };
      }
      case 'oracle': {
        const oracledb = (await import('oracledb')).default;
        return {
          ...this.getOracleOptions(this.dbConfig, undefined, oracledb),
          replication: {
            master: this.getOracleOptions(
              this.dbConfig,
              this.dbConfig.master,
              oracledb
            ),
            slaves:
              this.dbConfig.slaves?.map((slave) =>
                this.getOracleOptions(
                  this.dbConfig as TOracleDbConfig,
                  slave,
                  oracledb
                )
              ) ?? [],
          },
        };
      }
      default:
        throw new ServerError('Unknown database type!');
    }
  }

  /**
   * Creates a database adapter for the given database type.
   * The adapter is responsible for serializing and deserializing data
   * from the database.
   * @returns {TAdapterUtilsClassTypes} - the database adapter
   */
  private async databaseAdapterFactory(): Promise<TAdapterUtilsClassTypes> {
    const fetchHandlerOptions: IRegisteredFetchHandlerOptions = {
      isNeedRegisterDefaultSerializers:
        this.dbConfig.isNeedRegisterDefaultSerializers ?? false,
      caseStrategy: this.caseSettings.strategy,
    };
    switch (this.dbConfig.type) {
      case 'postgres': {
        const { PostgreAdapter } =
          await import('../adapters/postgres/postgre-adapter.js');
        return new PostgreAdapter(
          this.appDataSource,
          this.logger,
          fetchHandlerOptions,
          this.dbConfig.packagesSettings?.listenEventName
        );
      }
      case 'oracle': {
        const { OracleAdapter } =
          await import('../adapters/oracle/oracle-adapter.js');
        return new OracleAdapter(
          this.appDataSource,
          this.logger,
          fetchHandlerOptions
        );
      }
    }
  }
  /**
   * Returns the options for the Postgres data source connection.
   * These options are used to configure the data source connection.
   * @returns {PostgresConnectionOptions} - the options for the Postgres data source connection
   * @private
   */
  private getPostgresOptions(
    config: TPostgresDbConfig,
    credentials: IDatabaseCredentials | undefined,
    driver: PostgresConnectionOptions['driver']
  ): PostgresConnectionOptions {
    const queryTimeoutMs = normalizeQueryTimeoutMs(config.queryTimeoutMs);
    const defaultObject: PostgresConnectionOptions = {
      type: 'postgres',
      driver,
      parseInt8: config.parseInt8AsBigInt,
      installExtensions: true,
      uuidExtension: 'uuid-ossp',
      applicationName: config.appName,
      ...(queryTimeoutMs !== undefined
        ? { statement_timeout: queryTimeoutMs }
        : {}),
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
    credentials: IDatabaseCredentials | undefined,
    driver: OracleConnectionOptions['driver']
  ): OracleConnectionOptions {
    const queryTimeoutMs = normalizeQueryTimeoutMs(config.queryTimeoutMs);
    const thickMode: OracleConnectionOptions['thickMode'] = config.libraryPath
      ? { libDir: config.libraryPath }
      : undefined;
    const defaultObject: OracleConnectionOptions = {
      type: 'oracle',
      driver,
      serviceName: config.master.database,
      thickMode,
      ...(queryTimeoutMs !== undefined ? { queryTimeoutMs } : {}),
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
