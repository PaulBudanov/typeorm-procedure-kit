import { SHUTDOWN_SIGNALS } from '../consts/shuwtdown.consts.js';
import { QueryLogContextBuilder } from '../utils/query-log-context-builder.js';
import { QueryLogContextStorage } from '../utils/query-log-context.js';
import { ServerError } from '../utils/server-error.js';

import { ConnectionBase } from './connection-base.js';
import { DatabaseInitializerBase } from './database-initializer-base.js';
import { ExecuteBase } from './execute-base.js';
import { NotifyBase } from './notify-base.js';
import { ProcedureListBase } from './procedure-list-base.js';
import { SerializerBase } from './serializer-base.js';

import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { IModuleConfig } from '../types/base.types.js';
import type {
  IExecutionOptions,
  TConnectionMode,
} from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type {
  ICreateNotify,
  IOracleOptionsNotify,
  TNotifyPackageCallback,
} from '../types/notification.types.js';
import type { TProcedureKitState } from '../types/procedure-kit.types.js';
import type {
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../types/procedure.types.js';
import type {
  TSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../types/serializer.types.js';
import type { IProcedureResult } from '../types/utility.types.js';

export class TypeOrmProcedureKit {
  private readonly databaseInitializerBase: DatabaseInitializerBase;
  private readonly logger: ILoggerModule;
  private connectionBase: ConnectionBase | null = null;
  private executeBase: ExecuteBase | null = null;
  private notifyBase: NotifyBase | null = null;
  private procedureListBase: ProcedureListBase | null = null;
  private serialzierBase: SerializerBase | null = null;
  private state: TProcedureKitState = 'new';
  private initPromise: Promise<void> | null = null;
  private destroyPromise: Promise<void> | null = null;
  private readonly shutdownHandlers = new Map<NodeJS.Signals, () => void>();
  /**
   * Creates a new instance of the TypeOrmProcedureKit class.
   *
   * @param settings - The settings object containing all the necessary configuration.
   */
  public constructor(private readonly settings: IModuleConfig) {
    this.logger = this.settings.logger.module;
    this.databaseInitializerBase = new DatabaseInitializerBase(
      this.settings.config,
      this.settings.logger,
      this.settings.entity,
      this.settings.migration
    );
    if (this.settings.isRegisterShutdownHandlers)
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
    this.connectionBase = new ConnectionBase(
      this.databaseInitializerBase.appDataSource,
      this.logger
    );
    this.executeBase = new ExecuteBase(
      this.connectionBase,
      this.databaseInitializerBase.databaseAdapter,
      this.logger,
      this.settings.logger.bindingLogMode
    );
    this.procedureListBase = new ProcedureListBase(
      this.logger,
      this.databaseInitializerBase.databaseAdapter,
      this.executeBase,
      this.settings.config.packagesSettings,
      this.databaseInitializerBase.resolvedResourceLimits.maxMetadataRows
    );
    this.notifyBase = new NotifyBase(
      this.databaseInitializerBase.databaseAdapter,
      this.procedureListBase,
      this.logger,
      this.settings.config.packagesSettings
    );
    this.serialzierBase = new SerializerBase(
      this.databaseInitializerBase.databaseAdapter
    );
  }

  private assertNotDestroyed(): void {
    if (this.state === 'destroying' || this.state === 'destroyed') {
      throw new ServerError(
        'TypeOrmProcedureKit is shutting down or destroyed'
      );
    }
  }

  private requireConnectionBase(): ConnectionBase {
    this.assertNotDestroyed();
    if (!this.connectionBase)
      throw new ServerError('TypeOrmProcedureKit is not initialized');
    return this.connectionBase;
  }

  private requireExecuteBase(): ExecuteBase {
    this.assertNotDestroyed();
    if (!this.executeBase)
      throw new ServerError('TypeOrmProcedureKit is not initialized');
    return this.executeBase;
  }

  private requireNotifyBase(): NotifyBase {
    this.assertNotDestroyed();
    if (!this.notifyBase)
      throw new ServerError('TypeOrmProcedureKit is not initialized');
    return this.notifyBase;
  }

  private requireProcedureListBase(): ProcedureListBase {
    this.assertNotDestroyed();
    if (!this.procedureListBase)
      throw new ServerError('TypeOrmProcedureKit is not initialized');
    return this.procedureListBase;
  }

  private requireSerializerBase(): SerializerBase {
    this.assertNotDestroyed();
    if (!this.serialzierBase)
      throw new ServerError('TypeOrmProcedureKit is not initialized');
    return this.serialzierBase;
  }
  /**
   * Initializes the database connection, runs migrations if needed and fetches the procedure list for all packages.
   * If packages are set in the settings, it also creates a notification channel for the packages and subscribes to it.
   * @returns {Promise<void>} - promise that resolves when the database is initialized
   */
  public initDatabase(): Promise<void> {
    this.assertNotDestroyed();
    if (this.state === 'ready') return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.state = 'initializing';
    const initPromise = this.initDatabaseInternal();
    this.initPromise = initPromise;
    const clearInitPromise = (): void => {
      if (this.initPromise === initPromise) this.initPromise = null;
    };
    void initPromise.then(clearInitPromise, clearInitPromise);
    return initPromise;
  }

  private async initDatabaseInternal(): Promise<void> {
    try {
      await this.databaseInitializerBase.initDatabaseModule();
      this.initMainClasses();
      const procedureListBase = this.requireProcedureListBase();
      await procedureListBase.initPackagesMap();
      const packagesSettings = this.settings.config.packagesSettings;
      if (
        packagesSettings &&
        packagesSettings.packages.length > 0 &&
        packagesSettings.isNeedDynamicallyUpdatePackagesInfo
      ) {
        const notifyBase = this.requireNotifyBase();
        const configuredNotificationSql =
          packagesSettings.metadataNotificationSql?.trim();
        const metadataNotificationSql =
          configuredNotificationSql && configuredNotificationSql.length > 0
            ? configuredNotificationSql
            : this.databaseInitializerBase.databaseAdapter.getPackagesNotifySql(
                packagesSettings.packages
              );
        await notifyBase.createNotification<TNotifyPackageCallback>({
          sql: metadataNotificationSql,
          notifyCallback:
            notifyBase.schedulePackageNotifyCallback.bind(notifyBase),
        });
      }
      if (this.state === 'initializing') this.state = 'ready';
    } catch (initializationError) {
      const rollbackErrors = await this.cleanupResources(false);
      if (this.state !== 'destroying') {
        if (rollbackErrors.length === 0) {
          try {
            this.databaseInitializerBase.resetAfterFailedInitialization();
            this.state = 'new';
          } catch (error) {
            rollbackErrors.push(ServerError.ENSURE_SERVER_ERROR({ error }));
            this.state = 'destroyed';
          }
        } else {
          this.state = 'destroyed';
        }
        if (this.state === 'destroyed') this.removeShutdownHandlers();
      }

      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [
            ServerError.ENSURE_SERVER_ERROR({
              error: initializationError,
            }),
            ...rollbackErrors,
          ],
          'Database initialization failed and rollback was incomplete',
          { cause: initializationError }
        );
      }
      throw initializationError;
    }
  }

  /**
   * Calls a stored procedure with the given execute string and params.
   * The execute string can be in the format of either 'packageName.procedureName' or just 'procedureName'.
   * If the execute string is in the format of 'packageName.procedureName', it will be parsed into a procedure name and package name.
   * If the execute string is just 'procedureName', it will be parsed into a procedure name and package name only if there is one package in the packages array.
   * If the execute string cannot be parsed into a procedure name and package name, it will throw a ServerError.
   * @param executeString - the string to be parsed
   * @param params - typed object or array with data to be passed to the procedure, or undefined/null
   * @param executionOptions - options for connection mode, setup commands, and query id
   * @returns result envelope containing flattened cursor rows and all output bindings
   * @throws ServerError - if the executeString cannot be parsed into a procedure name and package name
   */
  public call<
    TRow,
    TPayload extends TProcedurePayload = TProcedurePayload,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    executeString: string,
    params?: TProcedurePayloadInput<TPayload>,
    executionOptions?: IExecutionOptions
  ): Promise<IProcedureResult<TRow, TOut>> {
    this.assertNotDestroyed();
    const packages = this.settings.config.packagesSettings?.packages;
    if (!packages || packages.length < 1) {
      throw new ServerError(
        'Procedure packages are not configured. Set config.packagesSettings before calling procedures.'
      );
    }
    const procedureListBase = this.requireProcedureListBase();
    const { processName, packageName } = procedureListBase.parseProcedureName(
      executeString,
      packages
    );
    const procedureArguments =
      procedureListBase.packagesWithProceduresList.get(packageName)?.[
        processName
      ];
    const {
      paramExecuteString,
      bindings,
      cursorsNames = [],
      outBindings = [],
    } = this.databaseInitializerBase.databaseAdapter.makeBindings<TPayload>(
      packageName,
      processName,
      procedureListBase.packagesWithProceduresList.get(packageName),
      params
    );
    const logContext = QueryLogContextBuilder.createProcedureContext(
      packageName,
      processName,
      procedureArguments,
      bindings,
      cursorsNames
    );
    return QueryLogContextStorage.run(logContext, () =>
      this.requireExecuteBase().executeProcedure<TRow, TOut>(
        paramExecuteString,
        bindings,
        cursorsNames,
        outBindings,
        executionOptions
      )
    );
  }

  /**
   * Executes a raw SQL statement inside the same transaction flow as a procedure call.
   *
   * Parameters are read from uppercase `:PARAM_NAME` placeholders. PostgreSQL
   * rewrites them to positional `$1`, `$2` bindings, while Oracle keeps the
   * original placeholders and passes the binding array to the driver.
   *
   * @param sql - SQL query string with optional uppercase named parameters.
   * @param [params] - Object with values for the named SQL parameters.
   * @param [executionOptions] - options for connection mode, setup commands, and query id.
   * @returns Promise that resolves with an array of result objects.
   * @throws ServerError - If an error occurs during command execution.
   */
  public callSqlTransaction<T>(
    sql: string,
    params?: Record<string, unknown>,
    executionOptions?: IExecutionOptions
  ): Promise<Array<T>> {
    this.assertNotDestroyed();
    const { sqlString, bindings } =
      this.databaseInitializerBase.databaseAdapter.makeSqlBindings(sql, params);
    const logContext = QueryLogContextBuilder.createSqlContext(sql, params);
    return QueryLogContextStorage.run(logContext, () =>
      this.requireExecuteBase().execute(
        sqlString,
        bindings,
        [],
        executionOptions
      )
    );
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
    options: ICreateNotify<T>,
    additionalOptions?: IOracleOptionsNotify
  ): Promise<string> {
    return this.requireNotifyBase().createNotification<T>(
      options,
      additionalOptions
    );
  }
  /**
   * Unsubscribes from a notification channel.
   * @param {string} channel - name of the channel to unsubscribe from
   * @returns {Promise<void>} - promise that resolves when the subscription is unsubscribed
   * @throws {Error} - if there is an error unsubscribing from the channel
   */
  public unlistenNotify(channel: string): Promise<void> {
    return this.requireNotifyBase().unlistenNotification(channel);
  }

  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param {TSetSerializer} serializer - an object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws {Error} - If the serializer type is unknown.
   */
  public setSerializer(serializer: TSetSerializer): void {
    this.requireSerializerBase().setSerializer(serializer);
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   */
  public deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void {
    this.requireSerializerBase().deleteSerializer(serializerType);
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public deleteAllSerializers(): void {
    this.requireSerializerBase().deleteAllSerializers();
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
    return this.requireConnectionBase().getEntityManager(mode);
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
    return this.requireConnectionBase().releaseEntityManager(connection);
  }
  /**
   * A read-only map of serializers, where the key is the name of the serializer
   * and the value is the serializer itself.
   *
   * @readonly
   * @throws {Error} If you try to modify the map.
   */
  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return this.requireSerializerBase().serializerReadOnlyMapping;
  }

  /**
   * Gets the database adapter that was used to initialize the database.
   * @returns {TAdapterUtilsClassTypes} - the database adapter
   */
  public get databaseAdapter(): TAdapterUtilsClassTypes {
    this.assertNotDestroyed();
    return this.databaseInitializerBase.databaseAdapter;
  }

  /**
   * Returns the data source object that was used to initialize the database.
   * This data source object can be used to perform database operations.
   * @returns {DataSource} - the data source object
   */
  public get dataSource(): DataSource {
    this.assertNotDestroyed();
    return this.databaseInitializerBase.appDataSource;
  }

  /**
   * Gracefully shuts down all resources:
   * - Unsubscribes from all notification channels
   * - Destroys the DataSource connection pool
   * - Cleans up all database connections
   * @returns {Promise<void>} - resolves when all cleanup is completed
   */
  public destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    if (this.state === 'destroyed') {
      this.logger.warn('TypeOrmProcedureKit already destroyed');
      return Promise.resolve();
    }

    this.state = 'destroying';
    this.destroyPromise = this.destroyInternal();
    return this.destroyPromise;
  }

  private async destroyInternal(): Promise<void> {
    const errors: Array<Error> = [];
    try {
      const pendingInitialization = this.initPromise;
      if (pendingInitialization) {
        try {
          await pendingInitialization;
        } catch {
          // Initialization reports its own failure and performs rollback. Final
          // shutdown still proceeds for any resources that survived rollback.
        }
      }
      errors.push(...(await this.cleanupResources(true)));
    } finally {
      this.removeShutdownHandlers();
      this.state = 'destroyed';
      this.logger.log('TypeOrmProcedureKit shutdown completed');
    }

    if (errors.length > 0)
      throw new AggregateError(
        errors,
        'Some resources failed to cleanup during shutdown'
      );
  }

  private async cleanupResources(
    isDestroyCaseStrategy: boolean
  ): Promise<Array<Error>> {
    const errors: Array<Error> = [];
    const notifyBase = this.notifyBase;
    const procedureListBase = this.procedureListBase;
    this.notifyBase = null;
    this.procedureListBase = null;
    this.connectionBase = null;
    this.executeBase = null;
    this.serialzierBase = null;

    try {
      if (notifyBase) {
        await notifyBase.destroy();
        this.logger.log('Notifications cleanup completed');
      }
    } catch (error: unknown) {
      const cleanupError = ServerError.ENSURE_SERVER_ERROR({ error });
      errors.push(cleanupError);
      this.logger.error(`Notification cleanup error: ${cleanupError.message}`);
    }

    try {
      await procedureListBase?.destroy();
    } catch (error: unknown) {
      const cleanupError = ServerError.ENSURE_SERVER_ERROR({ error });
      errors.push(cleanupError);
      this.logger.error(
        `Procedure metadata cleanup error: ${cleanupError.message}`
      );
    }

    try {
      if (this.databaseInitializerBase.isDataSourceInitialized) {
        await this.databaseInitializerBase.appDataSource.destroy();
        this.logger.log('DataSource destroyed');
      }
    } catch (error: unknown) {
      const cleanupError = ServerError.ENSURE_SERVER_ERROR({ error });
      errors.push(cleanupError);
      this.logger.error(`DataSource destroy error: ${cleanupError.message}`);
    }

    if (isDestroyCaseStrategy) {
      try {
        this.databaseInitializerBase.caseSettings.strategy.destroy();
      } catch (error: unknown) {
        const cleanupError = ServerError.ENSURE_SERVER_ERROR({ error });
        errors.push(cleanupError);
        this.logger.error(
          `Case strategy cleanup error: ${cleanupError.message}`
        );
      }
    }
    return errors;
  }

  /**
   * Registers OS signal handlers for graceful shutdown.
   * Call this once after creating the instance to enable automatic shutdown
   * on SIGTERM, SIGINT, and SIGQUIT signals.
   * @returns {void}
   */
  public registerShutdownHandlers(): void {
    this.assertNotDestroyed();
    if (this.shutdownHandlers.size > 0) return;

    SHUTDOWN_SIGNALS.forEach((signal) => {
      const shutdownHandler = (): void => {
        // Restore the process default immediately so a second signal can force
        // termination while graceful cleanup is still running.
        this.removeShutdownHandlers();
        this.logger.log(`Received ${signal}, initiating shutdown...`);
        void this.shutdownFromSignal(signal);
      };
      this.shutdownHandlers.set(signal, shutdownHandler);
      process.once(signal, shutdownHandler);
    });
  }

  private async shutdownFromSignal(signal: NodeJS.Signals): Promise<void> {
    try {
      await this.destroy();
    } catch (error: unknown) {
      const shutdownError = ServerError.ENSURE_SERVER_ERROR({ error });
      this.logger.error(`Shutdown error: ${shutdownError.message}`);
    } finally {
      try {
        process.kill(process.pid, signal);
      } catch (error: unknown) {
        const signalError = ServerError.ENSURE_SERVER_ERROR({ error });
        this.logger.error(
          `Failed to re-send ${signal} after shutdown: ${signalError.message}`
        );
      }
    }
  }

  private removeShutdownHandlers(): void {
    for (const [signal, shutdownHandler] of this.shutdownHandlers) {
      process.off(signal, shutdownHandler);
    }
    this.shutdownHandlers.clear();
  }
}
