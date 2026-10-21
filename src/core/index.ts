import { SHUTDOWN_SIGNALS } from '../consts/shutdown.consts.js';
import { QueryLogContextBuilder } from '../utils/query-log-context-builder.js';
import { QueryLogContextStorage } from '../utils/query-log-context.js';
import { ServerError } from '../utils/server-error.js';

import { ConnectionBase } from './connection-base.js';
import { DatabaseInitializerBase } from './database-initializer-base.js';
import { ExecuteBase } from './execute-base.js';
import { NotifyBase } from './notify-base.js';
import { ProcedureListBase } from './procedure-list-base.js';

import type { DataSource } from '../typeorm/data-source/DataSource.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { IModuleConfig } from '../types/base.types.js';
import type {
  IExecutionOptions,
  TConnectionMode,
  TDbConfig,
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
  /**
   * Logged by `initDatabase()` when dynamic package metadata refresh is configured but the adapter
   * cannot register change notifications, which only Oracle in node-oracledb Thin mode reports.
   */
  private static readonly CHANGE_NOTIFICATIONS_UNSUPPORTED_WARNING =
    'Dynamic package metadata refresh is switched off: Oracle change notifications require node-oracledb Thick mode (set libraryPath, or call oracledb.initOracleClient() before initDatabase()) and the CHANGE NOTIFICATION privilege. Package metadata is loaded once and is not refreshed when packages change.';
  private readonly databaseInitializerBase: DatabaseInitializerBase;
  private readonly logger: ILoggerModule;
  private connectionBase: ConnectionBase | null = null;
  private executeBase: ExecuteBase | null = null;
  private notifyBase: NotifyBase | null = null;
  private procedureListBase: ProcedureListBase | null = null;
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
   * Builds the runtime components from the initialized DataSource and database adapter. All of
   * them are built here together and cleared together by `cleanupResources()`:
   * - ConnectionBase: provides a connection to the database
   * - ExecuteBase: provides a way to execute a SQL query
   * - ProcedureListBase: provides a way to fetch procedures from the database
   * - NotifyBase: provides a way to listen to notifications from the database
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
  }

  private assertNotDestroyed(): void {
    if (this.state === 'destroying' || this.state === 'destroyed') {
      throw new ServerError(
        'TypeOrmProcedureKit is shutting down or destroyed'
      );
    }
  }

  /**
   * Returns a component built by `initMainClasses()`. All of them are built there together and
   * cleared together at the start of `cleanupResources()`, so one message covers every one.
   * @param component - the component field to read.
   * @returns the component.
   * @throws ServerError - once shutdown has begun, and while the component does not exist.
   */
  private requireInitialized<TComponent>(
    component: TComponent | null
  ): TComponent {
    this.assertNotDestroyed();
    if (component === null)
      throw new ServerError('TypeOrmProcedureKit is not initialized');
    return component;
  }

  /**
   * Returns the adapter for the members that call it directly: the serializer methods,
   * `callSqlTransaction()` and the `databaseAdapter` getter. The initializer's getter alone would
   * report `Database adapter is not initialized` before `initDatabase()`; the kit's own guard runs
   * first so that these members fail like the rest of the runtime API, over the same window.
   * `executeBase` stands in for the components, which exist or not together.
   * @returns the initialized database adapter.
   * @throws ServerError - once shutdown has begun, and before `initDatabase()` has built the
   * components.
   */
  private requireDatabaseAdapter(): TAdapterUtilsClassTypes {
    this.requireInitialized(this.executeBase);
    return this.databaseInitializerBase.databaseAdapter;
  }
  /**
   * Initializes the database connection, runs migrations if needed and fetches the procedure list for all packages.
   * If packages are set in the settings and `isNeedDynamicallyUpdatePackagesInfo` is on, it also subscribes to
   * package changes. When the adapter cannot register change notifications (Oracle in node-oracledb Thin mode),
   * it logs one warning and starts without the subscription; package metadata is then loaded once.
   *
   * Concurrent callers receive the same promise. Errors, including a call once shutdown has begun, are reported
   * by rejecting it, never by a synchronous throw.
   * @returns {Promise<void>} - promise that resolves when the database is initialized
   */
  public initDatabase(): Promise<void> {
    try {
      this.assertNotDestroyed();
    } catch (error: unknown) {
      // Not an async method: the shared initPromise must be handed out unchanged, so the
      // guard's error is turned into a rejection here.
      return Promise.reject(ServerError.ENSURE_SERVER_ERROR({ error }));
    }
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
      const procedureListBase = this.requireInitialized(this.procedureListBase);
      await procedureListBase.initPackagesMap();
      const packagesSettings = this.settings.config.packagesSettings;
      if (
        packagesSettings &&
        packagesSettings.packages.length > 0 &&
        packagesSettings.isNeedDynamicallyUpdatePackagesInfo
      ) {
        await this.subscribeToPackageChanges(packagesSettings);
      }
      if (this.state === 'initializing') this.state = 'ready';
    } catch (initializationError) {
      const rollbackErrors = await this.cleanupResources('keep-naming-cache');
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
        if (this.state === 'destroyed') {
          // The kit is terminal now and destroy() will not clean up again, so the naming cache
          // that a returning-to-new rollback keeps for the next attempt is cleared here.
          rollbackErrors.push(...this.destroyNamingCache());
          this.removeShutdownHandlers();
        }
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
   * Subscribes to package changes so that procedure metadata is refreshed when a configured package
   * changes. When the adapter cannot register change notifications, logs one warning and subscribes
   * to nothing: the metadata already loaded stays in use.
   * @param packagesSettings - the configured packages and their optional notification SQL.
   */
  private async subscribeToPackageChanges(
    packagesSettings: NonNullable<TDbConfig['packagesSettings']>
  ): Promise<void> {
    const databaseAdapter = this.databaseInitializerBase.databaseAdapter;
    if (!databaseAdapter.isChangeNotificationSupported()) {
      this.logger.warn(
        TypeOrmProcedureKit.CHANGE_NOTIFICATIONS_UNSUPPORTED_WARNING
      );
      return;
    }
    const notifyBase = this.requireInitialized(this.notifyBase);
    const configuredNotificationSql =
      packagesSettings.metadataNotificationSql?.trim();
    const metadataNotificationSql =
      configuredNotificationSql && configuredNotificationSql.length > 0
        ? configuredNotificationSql
        : databaseAdapter.getPackagesNotifySql(packagesSettings.packages);
    await notifyBase.createNotification<TNotifyPackageCallback>({
      sql: metadataNotificationSql,
      notifyCallback: notifyBase.schedulePackageNotifyCallback.bind(notifyBase),
    });
  }

  /**
   * Calls a stored procedure with the given execute string and params.
   * The execute string can be in the format of either 'packageName.procedureName' or just 'procedureName'.
   * If the execute string is in the format of 'packageName.procedureName', it will be parsed into a procedure name and package name.
   * If the execute string is just 'procedureName', it will be parsed into a procedure name and package name only if there is one package in the packages array.
   * If the execute string cannot be parsed into a procedure name and package name, the returned promise rejects with a ServerError.
   * @param executeString - the string to be parsed
   * @param params - typed object or array with data to be passed to the procedure, or undefined/null
   * @param executionOptions - options for connection mode, setup commands, and query id
   * @returns result envelope containing flattened cursor rows and all output bindings
   * @throws ServerError - as a rejection, never synchronously: if packages are not configured, if the
   * kit is not initialized or is shutting down, if the executeString cannot be parsed into a procedure
   * name and package name, or if the payload cannot be bound to the procedure arguments.
   */
  public async call<
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
    const procedureListBase = this.requireInitialized(this.procedureListBase);
    const { processName, packageName } = procedureListBase.parseProcedureName(
      executeString,
      packages
    );
    const procedures =
      procedureListBase.packagesWithProceduresList.get(packageName);
    const procedureArguments =
      procedures && Object.hasOwn(procedures, processName)
        ? procedures[processName]
        : undefined;
    const {
      paramExecuteString,
      bindings,
      logBindings,
      cursorsNames = [],
      outBindings = [],
    } = this.databaseInitializerBase.databaseAdapter.makeBindings<TPayload>(
      packageName,
      processName,
      procedures,
      params
    );
    const logContext = QueryLogContextBuilder.createProcedureContext(
      packageName,
      processName,
      procedureArguments,
      logBindings ?? bindings,
      cursorsNames
    );
    return QueryLogContextStorage.run(logContext, () =>
      this.requireInitialized(this.executeBase).executeProcedure<TRow, TOut>(
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
   * Parameters are read from `:name` placeholders outside string literals, quoted
   * identifiers and comments, and matched to the keys of `params` case-insensitively:
   * `:userId`, `:USERID` and `:userid` all read the key `userId`. PostgreSQL rewrites
   * them to positional `$1`, `$2` bindings, while Oracle keeps the original placeholders
   * and passes bindings keyed by placeholder name to the driver. A key set to `undefined`
   * binds SQL `NULL`, like `null`; a key inherited from a prototype counts as missing;
   * keys that match no placeholder are ignored. A spread placeholder such as `:...ids`
   * is rejected: raw SQL binds one value per placeholder and does not expand arrays, so
   * bind the array to one placeholder instead, as in `= ANY(:IDS)` on PostgreSQL.
   *
   * @param sql - SQL query string with optional named parameters.
   * @param [params] - Object with values for the named SQL parameters.
   * @param [executionOptions] - options for connection mode, setup commands, and query id.
   * @returns Promise that resolves with an array of result objects.
   * @throws ServerError - as a rejection, never synchronously: if the kit is not initialized or is
   * shutting down, if a placeholder has no key in `params`, if two keys that differ only in letter
   * case both give a placeholder a value other than `undefined`, if a placeholder is a spread
   * placeholder, or if the command fails.
   */
  public async callSqlTransaction<T>(
    sql: string,
    params?: Record<string, unknown>,
    executionOptions?: IExecutionOptions
  ): Promise<Array<T>> {
    const { sqlString, bindings } =
      this.requireDatabaseAdapter().makeSqlBindings(sql, params);
    const logContext = QueryLogContextBuilder.createSqlContext(sql, params);
    return QueryLogContextStorage.run(logContext, () =>
      this.requireInitialized(this.executeBase).execute(
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
   * @throws {ServerError} - as a rejection, never synchronously: if the kit is not initialized or is
   * shutting down, or if the subscription cannot be registered.
   * @example
   * const channelName = await db.makeNotify(
   *   {
   *     sql: 'LISTEN my_channel',
   *     notifyCallback: (data) => console.log(data),
   *   }
   * );
   */
  public async makeNotify<T>(
    options: ICreateNotify<T>,
    additionalOptions?: IOracleOptionsNotify
  ): Promise<string> {
    return this.requireInitialized(this.notifyBase).createNotification<T>(
      options,
      additionalOptions
    );
  }
  /**
   * Unsubscribes from a notification channel.
   * @param {string} channel - name of the channel to unsubscribe from
   * @returns {Promise<void>} - promise that resolves when the subscription is unsubscribed
   * @throws {Error} - as a rejection, never synchronously: if the kit is not initialized or is
   * shutting down, or if there is an error unsubscribing from the channel
   */
  public async unlistenNotify(channel: string): Promise<void> {
    return this.requireInitialized(this.notifyBase).unlistenNotification(
      channel
    );
  }

  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param {TSetSerializer} serializer - an object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws {ServerError} - If `serializer` is not an object, its `serializerType` is not a known
   * serializer type, or its `strategy` is not a function. Nothing is registered in that case.
   * @throws {ServerError} - If the kit is not initialized, or is shutting down or destroyed.
   */
  public setSerializer(serializer: TSetSerializer): void {
    this.requireDatabaseAdapter().setSerializer(serializer);
  }

  /**
   * Deletes a serializer with the given type. A known type that has no serializer registered is
   * ignored.
   * @param serializerType - The type of the serializer to delete.
   * @throws {ServerError} - If the argument is not an object or its `serializerType` is not a known
   * serializer type, so a misspelt type is reported rather than silently kept registered.
   * @throws {ServerError} - If the kit is not initialized, or is shutting down or destroyed.
   */
  public deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void {
    this.requireDatabaseAdapter().deleteSerializer(serializerType);
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   * @throws {ServerError} - If the kit is not initialized, or is shutting down or destroyed.
   */
  public deleteAllSerializers(): void {
    this.requireDatabaseAdapter().deleteAllSerializers();
  }
  /**
   * Retrieves an EntityManager from the pool.
   * @param {string} [mode] - The mode of the connection. 'master' or 'slave'. Defaults to 'master'.
   * @returns {Promise<EntityManager>} - A promise that resolves with the EntityManager.
   * @throws {Error} - as a rejection, never synchronously: if the kit is not initialized or is shutting
   * down, or if the connection to the database cannot be established.
   */
  public async getEntityManager(
    mode: TConnectionMode = 'master'
  ): Promise<EntityManager> {
    return this.requireInitialized(this.connectionBase).getEntityManager(mode);
  }
  /**
   * Releases a connection to the database back to the pool.
   * @param {EntityManager} connection - The connection to release.
   * @returns {Promise<void>} - A promise that resolves when the connection is released.
   * @throws {Error} - as a rejection, never synchronously: if the kit is not initialized or is shutting
   * down, or if the connection cannot be released.
   */
  public async releaseEntityManager(connection: EntityManager): Promise<void> {
    return this.requireInitialized(this.connectionBase).releaseEntityManager(
      connection
    );
  }
  /**
   * A read-only map of serializers, where the key is the name of the serializer
   * and the value is the serializer itself.
   *
   * It is the adapter's registry snapshot, unchanged: in canonical serializer-type order, detached
   * from later registrations, and the same object across reads until the registry changes.
   *
   * @readonly
   * @throws {ServerError} If you try to modify the map.
   * @throws {ServerError} If the kit is not initialized, or is shutting down or destroyed.
   */
  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return this.requireDatabaseAdapter().serializerMapping;
  }

  /**
   * Gets the database adapter that was used to initialize the database.
   * @returns {TAdapterUtilsClassTypes} - the database adapter
   * @throws {ServerError} - synchronously, as a getter: if the kit is not initialized, or is shutting
   * down or destroyed.
   */
  public get databaseAdapter(): TAdapterUtilsClassTypes {
    return this.requireDatabaseAdapter();
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
   *
   * Safe to call more than once. The first call starts the shutdown; every later call, during it
   * or after it, returns that same promise, so it resolves or rejects exactly as the first did and
   * logs nothing.
   * @returns {Promise<void>} - resolves when all cleanup is completed
   * @throws {AggregateError} - (as a rejection) if part of the cleanup failed.
   */
  public destroy(): Promise<void> {
    // Repeated calls are expected: a signal handler and a framework shutdown hook can both reach
    // here. They share the first call's outcome, a failed cleanup included, without a warning.
    if (this.destroyPromise) return this.destroyPromise;
    // Reached only when destroy() has never run: initDatabase() failed, could not roll back, and
    // made the kit terminal itself after rejecting with the rollback errors.
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
      errors.push(...(await this.cleanupResources('destroy-naming-cache')));
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

  /**
   * Clears the runtime components and closes notifications, procedure metadata and the DataSource.
   * Every step runs even when an earlier one fails; each failure is logged and returned.
   * @param namingCache - `destroy-naming-cache` for a final shutdown; `keep-naming-cache` for an
   * initialization rollback, after which `initDatabase()` may run again with the same case strategy.
   * @returns the cleanup errors, empty when every step succeeded.
   */
  private async cleanupResources(
    namingCache: 'keep-naming-cache' | 'destroy-naming-cache'
  ): Promise<Array<Error>> {
    const errors: Array<Error> = [];
    const notifyBase = this.notifyBase;
    const procedureListBase = this.procedureListBase;
    this.notifyBase = null;
    this.procedureListBase = null;
    this.connectionBase = null;
    this.executeBase = null;

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

    if (namingCache === 'destroy-naming-cache')
      errors.push(...this.destroyNamingCache());
    return errors;
  }

  /**
   * Clears the case strategy's naming cache. The cache cannot be used again afterwards, so this
   * runs only once the kit is terminal.
   * @returns the cleanup error, logged, or an empty array.
   */
  private destroyNamingCache(): Array<Error> {
    try {
      this.databaseInitializerBase.caseSettings.strategy.destroy();
      return [];
    } catch (error: unknown) {
      const cleanupError = ServerError.ENSURE_SERVER_ERROR({ error });
      this.logger.error(`Case strategy cleanup error: ${cleanupError.message}`);
      return [cleanupError];
    }
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
