import type oracledb from 'oracledb';

import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type {
  IDatabaseAdapterContract,
  TConnectionClassTypes,
  TNotifyClassTypes,
  TSerializerClassTypes,
} from '../../types/adapter.types.js';
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
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';
import { DatabaseOptionsExecutor } from '../../utils/database-options-executor.js';

export abstract class DatabaseAdapter<
  T extends TSerializerClassTypes,
  U extends TNotifyClassTypes,
  V extends TConnectionClassTypes,
  TNotifyOptions extends INotifyRetryOptions = INotifyRetryOptions,
> implements IDatabaseAdapterContract<TNotifyOptions> {
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
    protected readonly serializer: T,
    protected readonly notifier: U,
    protected readonly connection: V
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
    const sortedProcedures = rawArguments.reduce(
      (acc: TProcedureArgumentList, item: IProcedureArgumentBase) => {
        const itemObjectNameToLowerCase =
          item.procedureName.toLowerCase() as Lowercase<string>;
        if (
          item.argumentName === undefined ||
          item.argumentName === null ||
          (!procedureListBase.includes(
            `${packageName}.${itemObjectNameToLowerCase}` as Lowercase<string>
          ) &&
            packagesLength > 1)
        )
          return acc;
        acc[itemObjectNameToLowerCase] = acc[itemObjectNameToLowerCase] ?? [];
        acc[itemObjectNameToLowerCase].push({
          argumentName: item.argumentName.toLowerCase(),
          argumentType: item.argumentType,
          order: item.order,
          mode: item.mode,
        });
        acc[itemObjectNameToLowerCase].sort((a, b) => a.order - b.order);

        return acc;
      },
      {} as TProcedureArgumentList
    );
    return sortedProcedures;
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
    cursorsNames: Array<string> = [],
    queryTimeoutMs?: number
  ): Promise<Awaited<Array<T>>> {
    return client.transaction(async (manager) => {
      const setupCommands = [
        ...this.getTimeoutSetupCommands(manager, queryTimeoutMs),
        ...(optionsCommands ?? []),
      ];
      if (setupCommands.length > 0) {
        await DatabaseOptionsExecutor.executeCommands(
          setupCommands,
          manager,
          this.logger
        );
      }
      const result = await manager.query<Array<T | oracledb.ResultSet<T>>>(
        sql,
        bindings
      );
      const isCursorResult =
        Array.isArray(result) &&
        result.length > 0 &&
        typeof result[0] === 'object' &&
        result !== null &&
        cursorsNames.length > 0;
      if (isCursorResult) {
        return this.fetchAllCursors<T>(cursorsNames, result, manager);
      }
      return result as Array<T>;
    });
  }

  private getTimeoutSetupCommands(
    manager: EntityManager,
    queryTimeoutMs?: number
  ): Array<string> {
    if (!queryTimeoutMs || queryTimeoutMs <= 0) return [];
    if (manager.connection.options.type !== 'postgres') return [];
    return [`SET LOCAL statement_timeout = ${Math.trunc(queryTimeoutMs)}`];
  }

  /**
   * Builds the vendor-specific SQL query used to load procedure metadata for a
   * package or schema.
   * @param packageName - package or schema name to inspect.
   * @returns SQL query string for procedure metadata loading.
   */
  public abstract generatePackageInfoSql(packageName: string): string;

  /**
   * Converts named `:PARAM` placeholders and parameter values to the binding
   * format expected by the current database driver.
   * @param sqlQuery - SQL query containing uppercase named placeholders.
   * @param params - object with values for placeholders.
   * @returns rewritten SQL and ordered binding values.
   */
  public abstract makeSqlBindings<U extends Record<string, unknown>>(
    sqlQuery: string,
    params?: U
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
   * Reads all output cursors returned by a procedure call.
   * @param cursorNames - output cursor names from procedure metadata.
   * @param result - raw driver result containing cursor handles when required.
   * @param manager - entity manager used by adapters that fetch cursors by SQL.
   * @returns rows read from all cursors.
   */
  protected abstract fetchAllCursors<T>(
    cursorNames: Array<string>,
    result?: Array<oracledb.ResultSet<T> | T>,
    manager?: EntityManager
  ): Promise<Array<T>>;

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
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void,
    options?: TNotifyOptions
  ): Promise<string> {
    return this.notifier.listenNotify<T>(
      sqlCommand,
      notifyCallback,
      options ?? ({} as TNotifyOptions)
    );
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
