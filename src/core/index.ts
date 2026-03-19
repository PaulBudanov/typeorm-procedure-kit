import oracledb from 'oracledb';

import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { IModuleConfig } from '../types/base.types.js';
import type { TConnectionMode } from '../types/config.types.js';
import type {
  ICreateNotify,
  IOracleOptionsNotify,
  TNotifyPackageCallback,
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
  private isDestroyed = false;
  /**
   * Creates a new instance of the TypeOrmProcedureKit class.
   *
   * @param settings - The settings object containing all the necessary configuration.
   */
  public constructor(private readonly settings: IModuleConfig) {
    this.initMainClasses();
    this.registerShutdownHandlers();
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
      this.settings.logger,
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
      await this.notifyBase.createNotification<TNotifyPackageCallback>(
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
  /**
   * Create a notification channel and subscribe to it.
   * @param {ICreateNotify<T>} options - options for creating the notification channel
   * @param {IOracleOptionsNotify} [additionalOptions] - additional options for Oracle database, if applicable
   * @returns {Promise<string>} - promise that resolves with the name of the notification channel
   * @example
   * const channelName = await db.makeNotify(
   *   {
   *     sql: 'LISTEN my_channel',
   *     notifyCallback: (data) => console.log(data),
   *   }
   * );
   */
  public makeNotify<T>(
    options: ICreateNotify,
    additionalOptions?: IOracleOptionsNotify
  ): Promise<string> {
    return this.notifyBase.createNotification<T>(options, additionalOptions);
  }
  /**
   * Unsubscribes from a notification channel.
   * @param {string} channel - name of the channel to unsubscribe from
   * @returns {Promise<void>} - promise that resolves when the subscription is unsubscribed
   * @throws {Error} - if there is an error unsubscribing from the channel
   */
  public unlistenNotify(channel: string): Promise<void> {
    return this.notifyBase.unlistenNotification(channel);
  }

  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param {ISetSerializer} serializer - an object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws {Error} - If the serializer type is unknown.
   */
  public setSerializer(serializer: ISetSerializer): void {
    this.serialzierBase.setSerializer(serializer);
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   */
  public deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void {
    this.serialzierBase.deleteSerializer(serializerType);
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public deleteAllSerializers(): void {
    this.serialzierBase.deleteAllSerializers();
  }
  /**
   * Retrieves an EntityManager from the pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * @param {string} [mode] - The mode of the connection. 'master' or 'slave'. Defaults to 'master'.
   * @returns {Promise<EntityManager>} - A promise that resolves with the EntityManager.
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  public getEntityManager(
    mode: TConnectionMode = 'master'
  ): Promise<EntityManager> {
    return this.connectionBase.getEntityManager(mode);
  }
  /**
   * Releases a connection to the database back to the pool.
   * If the connection to the database is not established, throws an error.
   * If the connection is not initialized, throws an error.
   * @param {EntityManager} connection - The connection to release.
   * @returns {Promise<void>} - A promise that resolves when the connection is released.
   * @throws {Error} - If the connection to the database is not established or the connection is not initialized.
   */
  public releaseEntityManager(connection: EntityManager): Promise<void> {
    return this.connectionBase.releaseEntityManager(connection);
  }
  /**
   * A read-only map of serializers, where the key is the name of the serializer
   * and the value is the serializer itself.
   *
   * @readonly
   * @throws {Error} If you try to modify the map.
   */
  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return this.serialzierBase.serializerReadOnlyMapping;
  }

  /**
   * Gets the database adapter that was used to initialize the database.
   * @returns {TAdapterUtilsClassTypes} - the database adapter
   */
  public get databaseAdapter(): TAdapterUtilsClassTypes {
    return this.databaseInitializerBase.databaseAdapter;
  }

  /**
   * Returns the data source object that was used to initialize the database.
   * This data source object can be used to perform database operations.
   * @returns {DataSource} - the data source object
   */
  public get dataSource(): DataSource {
    return this.databaseInitializerBase.appDataSource;
  }

  /**
   * Gracefully shuts down all resources:
   * - Unsubscribes from all notification channels
   * - Destroys the DataSource connection pool
   * - Cleans up all database connections
   * @returns {Promise<void>} - resolves when all cleanup is completed
   */
  public async destroy(): Promise<void> {
    if (this.isDestroyed) {
      this.settings.logger.warn('TypeOrmProcedureKit already destroyed');
      return;
    }

    this.isDestroyed = true;
    const errors: Array<Error> = [];
    // destroy notify
    try {
      await this.notifyBase.destroy();
      this.settings.logger.log('Notifications cleanup completed');
    } catch (error) {
      errors.push(error as Error);
      this.settings.logger.error(
        `Notification cleanup error: ${(error as Error).message}`
      );
    }
    // destroy datasource
    try {
      if (this.dataSource?.isInitialized) {
        await this.dataSource.destroy();
        this.settings.logger.log('DataSource destroyed');
      }
    } catch (error) {
      errors.push(error as Error);
      this.settings.logger.error(
        `DataSource destroy error: ${(error as Error).message}`
      );
    }
    // destroy cache
    procedureNameParser.destroy();

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        'Some resources failed to cleanup during shutdown'
      );
    }

    this.settings.logger.log('TypeOrmProcedureKit shutdown completed');
  }

  /**
   * Registers OS signal handlers for graceful shutdown.
   * Call this once after creating the instance to enable automatic shutdown
   * on SIGTERM, SIGINT, and SIGQUIT signals.
   * @returns {void}
   */
  public registerShutdownHandlers(): void {
    const shutdownHandler = async (signal: string): Promise<void> => {
      this.settings.logger.log(`Received ${signal}, initiating shutdown...`);
      try {
        await this.destroy();
        process.exit(0);
      } catch (error) {
        this.settings.logger.error(
          `Shutdown error: ${(error as Error).message}`
        );
        process.exit(1);
      }
    };

    const shutdownSignals: Array<NodeJS.Signals> = [
      'SIGTERM',
      'SIGINT',
      'SIGQUIT',
    ];

    shutdownSignals.forEach((signal) => {
      process.once(signal, () => void shutdownHandler(signal));
    });

    process.once('uncaughtException', async (error) => {
      this.settings.logger.error(
        `Uncaught exception: ${error.message}`,
        error.stack
      );
      await this.destroy();
      process.exit(1);
    });

    process.once('unhandledRejection', async (reason, _promise) => {
      this.settings.logger.error(
        `Unhandled rejection: ${reason instanceof Error ? reason.message : reason}`
      );
      await this.destroy();
      process.exit(1);
    });
  }
}
