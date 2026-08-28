import { DatabaseOptionsExecutor } from '../../utils/database-options-executor.js';

import { ProcedureMetadataNormalizer } from './procedure-metadata-normalizer.js';

import type {
  IAdapterNotificationCapability,
  IAdapterSerializerCapability,
} from './adapter-capabilities.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { IDatabaseAdapterContract } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';
import type {
  IProcedureArgumentBase,
  TProcedureArgumentList,
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../../types/procedure.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from '../../types/serializer.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
  IProcedureResult,
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';

export abstract class DatabaseAdapter<
  TSerializerClass extends IAdapterSerializerCapability,
  TNotificationClass extends IAdapterNotificationCapability<
    TNotifyOptions,
    TNotificationConnection
  >,
  TNotifyOptions extends INotifyRetryOptions = INotifyRetryOptions,
  TNotificationConnection = unknown,
> implements IDatabaseAdapterContract<TNotifyOptions> {
  private readonly procedureMetadataNormalizer =
    new ProcedureMetadataNormalizer();
  /**
   * Creates a database adapter facade around serializer, notification, and
   * single-connection helpers for one database vendor.
   * @param logger - logger used by adapter operations.
   * @param serializer - serializer registry used by driver fetch hooks.
   * @param notifier - notification adapter used for LISTEN/CQN subscriptions.
   * @param connection - single-connection helper used by notifications.
   */
  public constructor(
    protected readonly logger: ILoggerModule,
    protected readonly serializer: TSerializerClass,
    protected readonly notifier: TNotificationClass
  ) {}
  /**
   * Sorts the arguments for a given procedure in a package.
   * Removes procedures that are not present in the configured procedure list.
   * When several packages are configured, arguments for procedures outside the
   * current package are skipped.
   * Sorts the arguments by their position.
   * @param rawArguments - raw procedure argument rows loaded from database metadata.
   * @param procedureListBase - configured procedure names in lowercase.
   * @param packageName - package or schema currently being processed.
   * @param packagesLength - number of configured packages.
   * @returns procedure argument map grouped by normalized procedure name.
   */
  public sortArgumentsAlgorithm(
    rawArguments: Array<IProcedureArgumentBase>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number
  ): TProcedureArgumentList {
    return this.normalizeProcedureMetadata(
      rawArguments,
      procedureListBase,
      packageName,
      packagesLength,
      { vendor: 'Database', includeAllWhenSinglePackage: true }
    );
  }

  protected normalizeProcedureMetadata<TOverloadIdentity>(
    rawArguments: Array<IProcedureArgumentBase>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number,
    options: {
      vendor: 'Database' | 'Oracle' | 'PostgreSQL';
      noArgumentSentinel?: string;
      includeAllWhenSinglePackage?: boolean;
      getOverloadIdentity?: (
        argument: IProcedureArgumentBase
      ) => TOverloadIdentity | undefined;
    }
  ): TProcedureArgumentList {
    return this.procedureMetadataNormalizer.normalize(
      rawArguments,
      procedureListBase,
      packageName,
      packagesLength,
      options
    );
  }

  /**
   * Executes a SQL query or procedure call inside a transaction.
   * Option commands are executed in the same transaction before the main SQL.
   * If cursor names are provided, the vendor adapter reads cursor contents and
   * returns the fetched rows instead of the raw execute result.
   * @param sql - SQL query or procedure call string.
   * @param client - entity manager that owns the transaction.
   * @param optionsCommands - SQL commands to execute before the main statement.
   * @param bindings - positional or driver-specific bind values.
   * @param cursorsNames - output cursor names to fetch after the call.
   * @returns result rows from the query or fetched cursors.
   */
  public async execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: Array<string>,
    bindings: IBindingsObjectReturn['bindings'] = [],
    _cursorsNames: Array<string> = []
  ): Promise<Awaited<Array<T>>> {
    return client.transaction(async (manager) => {
      const setupCommands = optionsCommands;
      return DatabaseOptionsExecutor.executeWithCommands(
        setupCommands,
        manager,
        this.logger,
        () => manager.query<Array<T>>(sql, bindings)
      );
    });
  }

  /**
   * Executes a stored procedure inside a transaction and delegates vendor
   * output-bind normalization to the concrete adapter.
   */
  public async executeProcedure<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    sql: string,
    client: EntityManager,
    optionsCommands: Array<string>,
    bindings: IBindingsObjectReturn['bindings'] = [],
    cursorsNames: Array<string> = [],
    outBindings: Array<IProcedureOutBinding> = []
  ): Promise<IProcedureResult<TRow, TOut>> {
    return client.transaction(async (manager) => {
      const setupCommands = optionsCommands;
      return DatabaseOptionsExecutor.executeWithCommands(
        setupCommands,
        manager,
        this.logger,
        async () => {
          const result = await manager.query(sql, bindings);
          return this.createProcedureResult<TRow, TOut>(
            cursorsNames,
            outBindings,
            {
              result,
              manager,
            }
          );
        }
      );
    });
  }

  /**
   * Builds the vendor-specific SQL query used to load procedure metadata for a
   * package or schema.
   * @param packageName - package or schema name to inspect.
   * @param procedureMetadataSql - optional SQL template with `:PACKAGE_NAME`.
   * @returns SQL query string for procedure metadata loading.
   */
  public abstract generatePackageInfoSql(
    packageName: string,
    procedureMetadataSql?: string
  ): string;

  /**
   * Converts named `:PARAM` placeholders and parameter values to the binding
   * format expected by the current database driver.
   * @param sqlQuery - SQL query containing uppercase named placeholders.
   * @param params - object with values for placeholders.
   * @returns rewritten SQL and ordered binding values.
   */
  public abstract makeSqlBindings(
    sqlQuery: string,
    params?: Record<string, unknown>
  ): ISqlBindingsObjectReturn;

  /**
   * Builds a vendor-specific procedure call and bindings from loaded procedure
   * metadata and an object or array payload.
   * @param packageName - normalized package or schema name.
   * @param processName - normalized procedure name.
   * @param procedures - procedure argument metadata map.
   * @param payload - procedure input values as object, array, null, or undefined.
   * @returns procedure call SQL, binding values, and output cursor names.
   */
  public abstract makeBindings<U extends TProcedurePayload = TProcedurePayload>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: TProcedurePayloadInput<U>
  ): IBindingsObjectReturn;

  /**
   * Normalizes scalar and cursor output bindings returned by a procedure call.
   * @param cursorNames - output cursor names from procedure metadata.
   * @param result - raw driver result containing cursor handles when required.
   * @param manager - entity manager used by adapters that fetch cursors by SQL.
   * @returns procedure result envelope.
   */
  protected abstract createProcedureResult<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    cursorNames: Array<string>,
    outBindings: Array<IProcedureOutBinding>,
    executeResult: {
      result?: unknown;
      manager: EntityManager;
    }
  ): Promise<IProcedureResult<TRow, TOut>>;

  /**
   * Narrows the adapter-owned output record at the single generic boundary.
   * Runtime keys and values have already been normalized before this helper;
   * the caller supplies the public TOut shape.
   */
  protected asProcedureOut(
    value: Record<string, unknown>
  ): Record<string, unknown> {
    return value;
  }

  /**
   * Registers or replaces a serializer for driver result values.
   * @param options - serializer type and conversion strategy.
   */
  public setSerializer(options: ISetSerializer): void {
    this.serializer.setSerializer(options);
  }

  /**
   * Removes one serializer from the adapter registry.
   * @param serializerType - serializer type to remove.
   */
  public deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void {
    this.serializer.deleteSerializer(serializerType);
  }

  /**
   * Removes all serializers from the adapter registry.
   */
  public deleteAllSerializers(): void {
    this.serializer.deleteAllSerializers();
  }

  /**
   * Current mutable serializer registry.
   */
  public get serializerMapping(): TSerializerTypeCastWithoutFormat {
    return this.serializer.serializerMapping;
  }

  /**
   * Registers a database notification subscription through the vendor notifier.
   * PostgreSQL expects a `LISTEN channel` command. Oracle expects a CQN query.
   * @param sqlCommand - notification registration SQL.
   * @param notifyCallback - callback invoked with parsed notification payload.
   * @param options - vendor-specific notification and restore retry options.
   * @returns registered channel or subscription name.
   */
  public listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: TNotifyOptions
  ): Promise<string> {
    return this.notifier.listenNotify<T>(sqlCommand, notifyCallback, options);
  }

  /**
   * Unregisters a notification subscription by channel or subscription name.
   * @param channelName - channel or subscription name returned by listenNotify.
   */
  public unlistenNotify(channelName: string): Promise<void> {
    return this.notifier.unlistenNotify(channelName);
  }

  /**
   * Gracefully shuts down all notification subscriptions.
   */
  public async destroyNotifications(): Promise<void> {
    await this.notifier.destroy();
  }

  /**
   * Returns the active notification pool for diagnostics and external cleanup.
   */
  public getNotificationPool(): Map<string, unknown> {
    return this.notifier.getNotificationPool();
  }

  /**
   * Builds the SQL used to listen for package metadata change notifications.
   * @param packages - package names for adapters that require package filtering.
   * @returns vendor-specific notification SQL.
   */
  public getPackagesNotifySql(packages?: Array<string>): string {
    return this.notifier.getPackagesNotifySql(packages ?? []);
  }

  /**
   * Installs driver fetch hooks required by adapter serializers.
   */
  public registerFetchHandlerHook(): void {
    this.serializer.registerFetchHandlerHook();
  }
}
