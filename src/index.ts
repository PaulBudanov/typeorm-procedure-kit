import oracledb from 'oracledb';

import { NotifyBase } from './query-runner/notify-base.js';
import type {
  ICreateNotifyOptionsPublic,
  IEntityOptions,
  ILoggerModule,
  IMigrationOptions,
  INotifyPackageCallback,
  TDbConfig,
  TOptionsCommand,
  TSetSerializer,
} from './types.js';
import { getProcedureNameAndPackage } from './utils/getProcedureAndPackageName.js';

/**
 * Main class for working with databases
 * Contains methods for calling procedures and calling queries and creating notifications
 *
 * @class Database
 * @extends NotifyBase
 */
export class Database extends NotifyBase {
  /**
   * @constructor
   * @param {TDbConfig} dbConfig - database configuration
   * @param {Record<string, string | object>} procedureObjectList - list of uses procedures
   * @param {ILoggerModule} [logger] - logger
   * @param {boolean} [isNeedSynchronize] - flag for synchronize
   * @param {IEntityOptions} [entity] - entity configuration (optional)
   * @param {IMigrationOptions} [migration] - migration configuration (optional)
   */
  public constructor(
    protected readonly dbConfig: TDbConfig,
    protected readonly procedureObjectList: Record<string, string>,
    protected readonly logger: ILoggerModule,
    protected readonly entity?: IEntityOptions,
    protected readonly migration?: IMigrationOptions,
  ) {
    super(dbConfig, procedureObjectList, logger, entity, migration);
  }

  /**
   * Initializes the database by initializing the data source, db utils, and packages map.
   * If there are multiple packages, creates a notification for the package update set.
   *
   * @returns {Promise<void>} - promise that resolves when the database is initialized
   */
  public async initDataBase(): Promise<void> {
    await this.initDataSource();
    this.initDbUtils();
    await this.initPackagesMap();
    if (this.dbConfig.dbPackages.length > 0) {
      await this.createNotification<INotifyPackageCallback>({
        sql: this.dbUtilsInstance.getNotifySql(this.dbConfig.dbPackages),
        notifyCallback: this.packageNotifyCallback.bind(this),
        options:
          this.dbConfig.type === 'postgres'
            ? undefined
            : {
                operations: oracledb.CQN_OPCODE_INSERT,
              },
      });
    }
  }

  /**
   * Call procedure in database
   * @param {string} executeString - name of procedure in format PackageName(schema).ProcedureName or only ProcedureName if only one package(schema)
   * @param {U} [params] - parameters for procedure
   * @param {TOptionsCommand} [options] - options for database commands
   * @returns {Promise<T | T[]>} - result of procedure call
   */
  public call<T>(
    executeString: string,
    params?: Record<string, unknown> | Array<unknown>,
    options?: TOptionsCommand,
  ): Promise<Array<T>> {
    const { processName, packageName } = getProcedureNameAndPackage(
      executeString,
      this.packagesWithProceduresList,
      this.dbConfig.dbPackages,
    );
    const { paramExecuteString, bindings, cursorsNames } =
      this.dbUtilsInstance.makeBindings<
        Record<string, unknown> | Array<unknown>
      >(
        packageName,
        processName,
        this.packagesWithProceduresList.get(packageName),
        params,
      );
    return this.execute<T>(paramExecuteString, bindings, options, cursorsNames);
  }

  /**
   * Calls a SQL query in a transaction
   * @param {string} sql - SQL query string
   * @param {Record<string, unknown>} [params] - parameters for SQL query
   * @param {TOptionsCommand} [options] - options for database commands
   * @returns {Promise<Array<T>>} - result of SQL query call
   */
  public callSqlTransaction<T>(
    sql: string,
    params?: Record<string, unknown>,
    options?: TOptionsCommand,
  ): Promise<Array<T>> {
    const { sqlString, bindings } = this.dbUtilsInstance.makeSqlBindings(
      sql,
      params,
    );
    return this.execute(sqlString, bindings, options);
  }

  /**
   * Create notification
   * @param {ICreateNotifyOptionsPublic} options - options for notification
   * @returns {Promise<string>} - name of notification
   */
  public makeNotify<T>(
    options: ICreateNotifyOptionsPublic<T>,
  ): Promise<string> {
    return this.dbConfig.type === 'postgres'
      ? this.createNotification<T>(options.postgres)
      : this.createNotification<T>(options.oracle);
  }

  /**
   * Unlisten notification
   * @param {string} channel - channel for notification
   * @returns {Promise<void>}
   */
  public unlistenNotify(channel: string): Promise<void> {
    return this.unlistenNotification(channel);
  }

  public setSerializer(options: TSetSerializer): void {
    this.setSerializer(options);
  }
}
