import oracledb from 'oracledb';

import type {
  IEntityOptions,
  IMigrationOptions,
  TDbConfig,
} from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type {
  ICreateNotify,
  INotifyPackageCallback,
  IOracleOptionsNotify,
} from '../types/notification.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from '../types/serializer.types.js';
import type { TOptionsCommand } from '../types/utility.types.js';
import { procedureNameParser } from '../utils/procedure-name-parser.js';

import { ConnectionBase } from './connection-base.js';
import { DatabaseInitializerBase } from './database-initializer-base.js';
import { ExecuteBase } from './execute-base.js';
import { NotifyBase } from './notify-base.js';
import { ProcedureListBase } from './procedure-list-base.js';
import { SerializerBase } from './serializer-base.js';

// /**
//  * Main class for working with databases
//  * Contains methods for calling procedures and calling queries and creating notifications
//  *
//  * @class Database
//  * @extends NotifyBase
//  */
// export class Database extends NotifyBase {
//   /**
//    * @constructor
//    * @param {TDbConfig} dbConfig - database configuration
//    * @param {Record<string, string | object>} procedureObjectList - list of uses procedures
//    * @param {ILoggerModule} [logger] - logger
//    * @param {boolean} [isNeedSynchronize] - flag for synchronize
//    * @param {IEntityOptions} [entity] - entity configuration (optional)
//    * @param {IMigrationOptions} [migration] - migration configuration (optional)
//    */
//   public constructor(
//     protected readonly dbConfig: TDbConfig,
//     protected readonly procedureObjectList: Record<string, string>,
//     protected readonly logger: ILoggerModule,
//     protected readonly entity?: IEntityOptions,
//     protected readonly migration?: IMigrationOptions
//   ) {
//     super(dbConfig, procedureObjectList, logger, entity, migration);
//   }

//   /**
//    * Initializes the database by initializing the data source, db utils, and packages map.
//    * If there are multiple packages, creates a notification for the package update set.
//    *
//    * @returns {Promise<void>} - promise that resolves when the database is initialized
//    */
//   public async initDataBase(): Promise<void> {
//     await this.initDataSource();
//     this.initDbUtils();
//     await this.initPackagesMap();
//     if (this.dbConfig.dbPackages.length > 0) {
//       await this.createNotification<INotifyPackageCallback>({
//         sql: this.dbUtilsInstance.getNotifySql(this.dbConfig.dbPackages),
//         notifyCallback: this.packageNotifyCallback.bind(this),
//         options:
//           this.dbConfig.type === 'postgres'
//             ? undefined
//             : {
//                 operations: oracledb.CQN_OPCODE_INSERT,
//               },
//       });
//     }
//   }

//   /**
//    * Call procedure in database
//    * @param {string} executeString - name of procedure in format PackageName(schema).ProcedureName or only ProcedureName if only one package(schema)
//    * @param {U} [params] - parameters for procedure
//    * @param {TOptionsCommand} [options] - options for database commands
//    * @returns {Promise<T | T[]>} - result of procedure call
//    */
//   public call<T>(
//     executeString: string,
//     params?: Record<string, unknown> | Array<unknown>,
//     options?: TOptionsCommand
//   ): Promise<Array<T>> {
//     const { processName, packageName } = getProcedureNameAndPackage(
//       executeString,
//       this.packagesWithProceduresList,
//       this.dbConfig.dbPackages
//     );
//     const { paramExecuteString, bindings, cursorsNames } =
//       this.dbUtilsInstance.makeBindings<
//         Record<string, unknown> | Array<unknown>
//       >(
//         packageName,
//         processName,
//         this.packagesWithProceduresList.get(packageName),
//         params
//       );
//     return this.execute<T>(paramExecuteString, bindings, options, cursorsNames);
//   }

//   /**
//    * Calls a SQL query in a transaction
//    * @param {string} sql - SQL query string
//    * @param {Record<string, unknown>} [params] - parameters for SQL query
//    * @param {TOptionsCommand} [options] - options for database commands
//    * @returns {Promise<Array<T>>} - result of SQL query call
//    */
//   public callSqlTransaction<T>(
//     sql: string,
//     params?: Record<string, unknown>,
//     options?: TOptionsCommand
//   ): Promise<Array<T>> {
//     const { sqlString, bindings } = this.dbUtilsInstance.makeSqlBindings(
//       sql,
//       params
//     );
//     return this.execute(sqlString, bindings, options);
//   }

//   /**
//    * Create notification
//    * @param {ICreateNotifyOptionsPublic} options - options for notification
//    * @returns {Promise<string>} - name of notification
//    */
//   public makeNotify<T>(
//     options: ICreateNotifyOptionsPublic<T>
//   ): Promise<string> {
//     return this.dbConfig.type === 'postgres'
//       ? this.createNotification<T>(options.postgres)
//       : this.createNotification<T>(options.oracle);
//   }

//   /**
//    * Unlisten notification
//    * @param {string} channel - channel for notification
//    * @returns {Promise<void>}
//    */
//   public unlistenNotify(channel: string): Promise<void> {
//     return this.unlistenNotification(channel);
//   }

//   // public static forRoot(): Database {
//   //   return new Database(
//   //     dbConfig,
//   //     procedureObjectList,
//   //     logger,
//   //     entity,
//   //     migration
//   //   );
//   // }

//   // public static forRootAsync(): Promise<Database> {
//   //   return new Database(
//   //     dbConfig,
//   //     procedureObjectList,
//   //     logger,
//   //     entity,
//   //     migration
//   //   ).initDataBase();
//   // }
// }

export class DatabaseModule {
  private connectionBase!: ConnectionBase;
  private databaseInitializerBase!: DatabaseInitializerBase;
  private executeBase!: ExecuteBase;
  private notifyBase!: NotifyBase;
  private procedureListBase!: ProcedureListBase;
  private serialzierBase!: SerializerBase;
  public constructor(
    protected readonly config: TDbConfig,
    protected readonly logger: ILoggerModule,
    protected readonly entity?: IEntityOptions,
    protected readonly migration?: IMigrationOptions
  ) {
    this.initMainClasses();
  }

  private initMainClasses(): void {
    this.databaseInitializerBase = new DatabaseInitializerBase(
      this.config,
      this.logger,
      this.entity,
      this.migration
    );
    this.connectionBase = new ConnectionBase(
      this.databaseInitializerBase.appDataSource,
      this.logger
    );
    this.executeBase = new ExecuteBase(
      this.connectionBase,
      this.databaseInitializerBase.databaseAdapter,
      this.logger
    );
    this.procedureListBase = new ProcedureListBase(
      this.logger,
      this.databaseInitializerBase.databaseAdapter,
      this.executeBase,
      this.config.packagesSettings
    );
    this.notifyBase = new NotifyBase(
      this.databaseInitializerBase.databaseAdapter,
      this.procedureListBase,
      this.config.packagesSettings
    );
    this.serialzierBase = new SerializerBase(
      this.databaseInitializerBase.databaseAdapter
    );
  }
  public async initDatabase(): Promise<void> {
    await this.databaseInitializerBase.initDatabaseModule();
    await this.procedureListBase.initPackagesMap();
    if (
      this.config.packagesSettings &&
      this.config.packagesSettings.packages.length > 0
    ) {
      const additionalOptions: IOracleOptionsNotify = {
        operations: oracledb.CQN_OPCODE_INSERT,
      };
      await this.notifyBase.createNotification<INotifyPackageCallback>(
        {
          sql: this.databaseInitializerBase.databaseAdapter.getPackagesNotifySql(
            this.config.packagesSettings.packages
          ),
          notifyCallback: this.notifyBase.packageNotifyCallback,
        },
        additionalOptions
      );
    }
  }

  public call<T>(
    executeString: string,
    params?: Record<string, unknown> | Array<unknown>,
    options?: TOptionsCommand
  ): Promise<Array<T>> {
    const { processName, packageName } = procedureNameParser.parse(
      executeString,
      this.procedureListBase.packagesWithProceduresList,
      this.config.packagesSettings!.packages
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
      options ? options[this.config.type] : undefined,
      cursorsNames
    );
  }
  public callSqlTransaction<T>(
    sql: string,
    params?: Record<string, unknown>,
    options?: TOptionsCommand
  ): Promise<Array<T>> {
    const { sqlString, bindings } =
      this.databaseInitializerBase.databaseAdapter.makeSqlBindings(sql, params);
    return this.executeBase.execute(
      sqlString,
      bindings,
      options ? options[this.config.type] : undefined
    );
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
