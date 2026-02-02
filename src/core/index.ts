import oracledb from 'oracledb';

import type { IModuleConfig } from '../types/base.types.js';
import type {
  ICreateNotify,
  INotifyPackageCallback,
  IOracleOptionsNotify,
} from '../types/notification.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from '../types/serializer.types.js';
import { procedureNameParser } from '../utils/procedure-name-parser.js';

import { ConnectionBase } from './connection-base.js';
import { DatabaseInitializerBase } from './database-initializer-base.js';
import { ExecuteBase } from './execute-base.js';
import { NotifyBase } from './notify-base.js';
import { ProcedureListBase } from './procedure-list-base.js';
import { SerializerBase } from './serializer-base.js';

export class TypeOrmProcedureKit {
  private connectionBase!: ConnectionBase;
  private databaseInitializerBase!: DatabaseInitializerBase;
  private executeBase!: ExecuteBase;
  private notifyBase!: NotifyBase;
  private procedureListBase!: ProcedureListBase;
  private serialzierBase!: SerializerBase;
  /**
   * Creates a new instance of the TypeOrmProcedureKit class.
   *
   * @param settings - The settings object containing all the necessary configuration.
   */
  public constructor(private readonly settings: IModuleConfig) {
    this.initMainClasses();
  }

  /**
   * Initializes the main classes used in the TypeOrmProcedureKit class.
   * These classes are:
   * - DatabaseInitializerBase: responsible for initializing the database connection and running migrations if needed
   * - ConnectionBase: provides a connection to the database
   * - ExecuteBase: provides a way to execute a SQL query
   * - ProcedureListBase: provides a way to fetch procedures from the database
   * - NotifyBase: provides a way to listen to notifications from the database
   * - SerializerBase: provides a way to set and get serializer mappings
   */
  private initMainClasses(): void {
    this.databaseInitializerBase = new DatabaseInitializerBase(
      this.settings.config,
      this.settings.logger,
      this.settings.entity,
      this.settings.migration
    );
    this.connectionBase = new ConnectionBase(
      this.databaseInitializerBase.appDataSource,
      this.settings.logger
    );
    this.executeBase = new ExecuteBase(
      this.connectionBase,
      this.databaseInitializerBase.databaseAdapter,
      this.settings.logger
    );
    this.procedureListBase = new ProcedureListBase(
      this.settings.logger,
      this.databaseInitializerBase.databaseAdapter,
      this.executeBase,
      this.settings.config.packagesSettings
    );
    this.notifyBase = new NotifyBase(
      this.databaseInitializerBase.databaseAdapter,
      this.procedureListBase,
      this.settings.config.packagesSettings
    );
    this.serialzierBase = new SerializerBase(
      this.databaseInitializerBase.databaseAdapter
    );
  }
  /**
   * Initializes the database connection, runs migrations if needed and fetches the procedure list for all packages.
   * If packages are set in the settings, it also creates a notification channel for the packages and subscribes to it.
   * @returns {Promise<void>} - promise that resolves when the database is initialized
   */
  public async initDatabase(): Promise<void> {
    await this.databaseInitializerBase.initDatabaseModule();
    await this.procedureListBase.initPackagesMap();
    if (
      this.settings.config.packagesSettings &&
      this.settings.config.packagesSettings.packages.length > 0
    ) {
      const additionalOptions: IOracleOptionsNotify = {
        operations: oracledb.CQN_OPCODE_INSERT,
      };
      await this.notifyBase.createNotification<INotifyPackageCallback>(
        {
          sql: this.databaseInitializerBase.databaseAdapter.getPackagesNotifySql(
            this.settings.config.packagesSettings.packages
          ),
          notifyCallback: this.notifyBase.packageNotifyCallback,
        },
        additionalOptions
      );
    }
  }

  /**
   * Calls a stored procedure or SQL query with the given execute string and params.
   * The execute string can be in the format of either 'packageName.procedureName' or just 'procedureName'.
   * If the execute string is in the format of 'packageName.procedureName', it will be parsed into a procedure name and package name.
   * If the execute string is just 'procedureName', it will be parsed into a procedure name and package name only if there is one package in the packages array.
   * If the execute string cannot be parsed into a procedure name and package name, it will throw a ServerError.
   * @param executeString - the string to be parsed
   * @param params - object or array with data to be passed to the procedure, or undefined/null
   * @param options - array of strings representing the options for the procedure call
   * @returns Promise<Array<T>> - promise that resolves with an array of result objects
   * @throws ServerError - if the executeString cannot be parsed into a procedure name and package name
   */
  public call<T>(
    executeString: string,
    params?: Record<string, unknown> | Array<unknown>,
    options?: Array<string>
  ): Promise<Array<T>> {
    const { processName, packageName } = procedureNameParser.parse(
      executeString,
      this.procedureListBase.packagesWithProceduresList,
      this.settings.config.packagesSettings!.packages
    );
    const { paramExecuteString, bindings, cursorsNames } =
      this.databaseInitializerBase.databaseAdapter.makeBindings<
        Record<string, unknown> | Array<unknown>
      >(
        packageName,
        processName,
        this.procedureListBase.packagesWithProceduresList.get(packageName),
        params
      );
    return this.executeBase.execute<T>(
      paramExecuteString,
      bindings,
      options,
      cursorsNames
    );
  }
  /**
   * Executes a SQL query or transaction in a single database call.
   * @param sql - SQL query string
   * @param [params] - object or array with data to be passed to the SQL query, or undefined/null
   * @param [options] - array of strings representing the options for the SQL query call
   * @returns Promise<Array<T>> - promise that resolves with an array of result objects
   * @throws ServerError - if an error occurs during the execution of commands
   */
  public callSqlTransaction<T>(
    sql: string,
    params?: Record<string, unknown>,
    options?: Array<string>
  ): Promise<Array<T>> {
    const { sqlString, bindings } =
      this.databaseInitializerBase.databaseAdapter.makeSqlBindings(sql, params);
    return this.executeBase.execute(sqlString, bindings, options);
  }
  public makeNotify<T>(
    options: ICreateNotify,
    additionalOptions?: IOracleOptionsNotify
  ): Promise<string> {
    return this.notifyBase.createNotification<T>(options, additionalOptions);
  }
  public unlistenNotify(channel: string): Promise<void> {
    return this.notifyBase.unlistenNotification(channel);
  }

  public setSerializer(serializer: ISetSerializer): void {
    this.serialzierBase.setSerializer(serializer);
  }

  public deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void {
    this.serialzierBase.deleteSerializer(serializerType);
  }

  public deleteAllSerializers(): void {
    this.serialzierBase.deleteAllSerializers();
  }
  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return this.serialzierBase.serializerReadOnlyMapping;
  }
}
