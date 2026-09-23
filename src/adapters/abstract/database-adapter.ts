import { replaceNamedParameters } from '../../typeorm/util/NamedParameterUtils.js';
import { DatabaseOptionsExecutor } from '../../utils/database-options-executor.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../utils/resource-limits.js';
import { ServerError } from '../../utils/server-error.js';

import { ProcedureMetadataNormalizer } from './procedure-metadata-normalizer.js';

import type {
  IAdapterNotificationCapability,
  IAdapterSerializerCapability,
} from './adapter-capabilities.js';
import type { IProcedureMetadataOptions } from '../../interfaces/procedure-metadata-normalizer.interfaces.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type {
  IDatabaseAdapterContract,
  IRegisteredFetchHandlerOptions,
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
  TSerializerTypeCastWithoutFormat,
  TSetSerializer,
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
  /** Placeholder every procedure-metadata SQL template must expose. */
  private static readonly PACKAGE_NAME_PLACEHOLDER = ':PACKAGE_NAME';
  /**
   * Shape of a raw SQL placeholder name that is bound: an unquoted identifier,
   * in any letter case. Other names `replaceNamedParameters` reports, such as
   * the digit-first `:2` of a PostgreSQL array slice `tags[1:2]` or a dotted
   * `:new.id`, stay in the SQL text untouched.
   */
  private static readonly RAW_SQL_PLACEHOLDER_PATTERN =
    /^[A-Za-z_][A-Za-z0-9_]*$/;
  /** Most supplied keys a missing-placeholder error lists by name. */
  private static readonly MAX_LISTED_RAW_SQL_KEYS = 20;
  private readonly procedureMetadataNormalizer =
    new ProcedureMetadataNormalizer();
  /** Adapter options supplied by the concrete vendor adapter. */
  protected abstract readonly handlerOptions: IRegisteredFetchHandlerOptions;
  /**
   * Vendor name, no-argument sentinel, and overload identity the shared
   * metadata normalizer applies to this vendor's dictionary rows.
   */
  protected abstract readonly procedureMetadataOptions: IProcedureMetadataOptions;
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
    return this.procedureMetadataNormalizer.normalize(
      rawArguments,
      procedureListBase,
      packageName,
      packagesLength,
      this.procedureMetadataOptions
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
   *
   * Template method: the shared sequence is validated identifier to package
   * literal substitution, while the concrete adapter supplies the vendor
   * identifier casing and the complete default metadata query, row limit
   * included. A caller-supplied template is substituted as is and never
   * receives a row limit.
   * @param packageName - package or schema name to inspect.
   * @param procedureMetadataSql - optional SQL template with `:PACKAGE_NAME`.
   * @returns SQL query string for procedure metadata loading.
   * @throws ServerError - when the template, supplied or default, has no
   * `:PACKAGE_NAME` placeholder.
   */
  public generatePackageInfoSql(
    packageName: string,
    procedureMetadataSql?: string
  ): string {
    const safePackageName = this.normalizePackageIdentifier(packageName);
    const sql =
      procedureMetadataSql ?? this.buildCheckedDefaultPackageInfoSql();
    return this.replacePackageNamePlaceholder(sql, `'${safePackageName}'`);
  }

  /**
   * Asks the vendor for its default metadata query and holds it to the
   * contract of `buildDefaultPackageInfoSql`, so a hook that drops the
   * placeholder fails here as an adapter defect rather than as the caller's
   * template error, or as a database error about a literal `:PACKAGE_NAME`.
   * @returns the vendor default SQL template.
   */
  private buildCheckedDefaultPackageInfoSql(): string {
    const sql = this.buildDefaultPackageInfoSql(
      this.resolveMetadataDetectionLimit()
    );
    if (!sql.includes(DatabaseAdapter.PACKAGE_NAME_PLACEHOLDER)) {
      throw new ServerError(
        'Default procedure metadata SQL built by the database adapter has no :PACKAGE_NAME placeholder; this is an adapter defect, not a procedureMetadataSql configuration error'
      );
    }
    return sql;
  }

  /**
   * Validates the requested package or schema name and returns it in the
   * identifier case used by the vendor data dictionary.
   * @param packageName - package or schema name requested by the caller.
   * @returns validated identifier ready to be inlined as a SQL literal.
   */
  protected abstract normalizePackageIdentifier(packageName: string): string;

  /**
   * Builds the complete vendor metadata query used when the caller supplies no
   * template of its own, with the row limit already woven in. Vendors that
   * wrap rather than append, and vendors whose limit form depends on the same
   * server capability as the template choice, decide both at once here.
   * @param detectionLimit - maximum number of rows the query may return.
   * @returns SQL template containing the `:PACKAGE_NAME` placeholder.
   */
  protected abstract buildDefaultPackageInfoSql(detectionLimit: number): string;

  /**
   * Replaces every `:PACKAGE_NAME` placeholder with the quoted package literal.
   * @param sql - metadata SQL template.
   * @param packageNameLiteral - quoted package or schema literal.
   * @returns SQL with every placeholder occurrence substituted.
   */
  private replacePackageNamePlaceholder(
    sql: string,
    packageNameLiteral: string
  ): string {
    if (!sql.includes(DatabaseAdapter.PACKAGE_NAME_PLACEHOLDER)) {
      throw new ServerError(
        'Procedure metadata SQL must contain :PACKAGE_NAME placeholder'
      );
    }
    return sql
      .split(DatabaseAdapter.PACKAGE_NAME_PLACEHOLDER)
      .join(packageNameLiteral);
  }

  /**
   * Row limit applied to metadata queries: one row above the configured
   * maximum so that an overflow can be detected.
   * @returns metadata row detection limit.
   */
  protected resolveMetadataDetectionLimit(): number {
    const maxMetadataRows =
      this.handlerOptions.resourceLimits?.maxMetadataRows ??
      DEFAULT_RESOURCE_LIMITS.maxMetadataRows;
    return Math.min(maxMetadataRows + 1, Number.MAX_SAFE_INTEGER);
  }

  /** Returns common metadata rows unchanged unless a vendor must collapse them. */
  public prepareProcedureMetadataRows(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    return rows;
  }

  /**
   * Converts named `:PARAM` placeholders and parameter values to the binding
   * format expected by the current database driver.
   *
   * Template method: the base finds every placeholder outside string
   * literals, quoted identifiers and comments, reads its name in uppercase,
   * and resolves its value from `params` case-insensitively, the way Oracle
   * resolves unquoted bind names; the concrete adapter decides what each
   * occurrence becomes in the SQL text and how the values reach the driver.
   *
   * A key counts as supplied when `params` carries it as an own enumerable
   * property whose value is not `undefined`: `null` binds SQL `NULL`, while
   * `undefined` and inherited properties count as absent. Keys that match no
   * placeholder are ignored. Two or more supplied keys that differ only in
   * letter case name one placeholder, so a placeholder that would read them
   * is rejected rather than bound to whichever key comes last; such keys stay
   * ignored when no placeholder reads them.
   * @param sqlQuery - SQL query containing named placeholders.
   * @param params - values keyed by placeholder name, case-insensitive.
   * @returns SQL for the driver and the binding values.
   * @throws ServerError - when a placeholder has no supplied value, or when
   * two or more supplied keys that differ only in letter case would bind it.
   */
  public makeSqlBindings(
    sqlQuery: string,
    params?: Record<string, unknown>
  ): ISqlBindingsObjectReturn {
    const suppliedParams = this.indexRawSqlParams(params);
    const placeholders: Array<[bindName: string, value: unknown]> = [];
    const sqlString = replaceNamedParameters(sqlQuery, ({ full, key }) => {
      if (!DatabaseAdapter.RAW_SQL_PLACEHOLDER_PATTERN.test(key)) return full;
      const bindName = key.toUpperCase();
      const sameNameParams = suppliedParams.get(bindName) ?? [];
      const [suppliedParam] = sameNameParams;
      if (suppliedParam === undefined) {
        throw this.createMissingRawSqlParamError(full, bindName, params);
      }
      if (sameNameParams.length > 1) {
        throw this.createConflictingRawSqlParamsError(
          full,
          sameNameParams.map(([suppliedKey]) => suppliedKey)
        );
      }
      placeholders.push([bindName, suppliedParam[1]]);
      return this.renderRawSqlPlaceholder(full, placeholders.length);
    });
    return { bindings: this.collectRawSqlBindings(placeholders), sqlString };
  }

  /**
   * Writes one bound placeholder occurrence back into the SQL text.
   * @param placeholder - the placeholder exactly as written, such as `:userId`.
   * @param position - 1-based position of this occurrence among the bound ones.
   * @returns the text that replaces the placeholder in the SQL for the driver.
   */
  protected abstract renderRawSqlPlaceholder(
    placeholder: string,
    position: number
  ): string;

  /**
   * Shapes the resolved values for the driver.
   * @param placeholders - one entry per bound occurrence, in SQL order, with
   * its uppercase bind name and resolved value.
   * @returns driver bindings.
   */
  protected abstract collectRawSqlBindings(
    placeholders: Array<[bindName: string, value: unknown]>
  ): ISqlBindingsObjectReturn['bindings'];

  /**
   * Indexes the supplied raw SQL values by uppercase key. Every supplied key
   * is kept, so keys that differ only in letter case share one entry and the
   * placeholder that reads them can reject the conflict; each value is read
   * from `params` once.
   * @param params - caller values keyed by placeholder name.
   * @returns supplied keys with their values, in `params` order, grouped by
   * uppercase bind name.
   */
  private indexRawSqlParams(
    params: Record<string, unknown> | undefined
  ): Map<string, Array<[key: string, value: unknown]>> {
    const suppliedParams = new Map<
      string,
      Array<[key: string, value: unknown]>
    >();
    if (!params) return suppliedParams;
    for (const key of Object.keys(params)) {
      const value = params[key];
      if (value === undefined) continue;
      const bindName = key.toUpperCase();
      const sameNameParams = suppliedParams.get(bindName);
      if (sameNameParams) sameNameParams.push([key, value]);
      else suppliedParams.set(bindName, [[key, value]]);
    }
    return suppliedParams;
  }

  /**
   * Builds the error for a placeholder that more than one supplied key would
   * bind, naming the placeholder as written and every such key, never values.
   * @param placeholder - the placeholder exactly as written.
   * @param conflictingKeys - the supplied keys that differ only in letter
   * case, in `params` order.
   * @returns the error to throw.
   */
  private createConflictingRawSqlParamsError(
    placeholder: string,
    conflictingKeys: Array<string>
  ): ServerError {
    const listedKeys = conflictingKeys
      .map((key) => JSON.stringify(key))
      .join(', ');
    return new ServerError(
      `Raw SQL placeholder ${placeholder} has more than one value in params; supplied keys that differ only in letter case: ${listedKeys}`
    );
  }

  /**
   * Builds the error for a placeholder without a supplied value, naming the
   * placeholder as written and the keys that were supplied, never values.
   * @param placeholder - the placeholder exactly as written.
   * @param bindName - uppercase bind name of the placeholder.
   * @param params - caller values keyed by placeholder name.
   * @returns the error to throw.
   */
  private createMissingRawSqlParamError(
    placeholder: string,
    bindName: string,
    params: Record<string, unknown> | undefined
  ): ServerError {
    const suppliedParams = params ?? {};
    const ownKeys = Object.keys(suppliedParams);
    // The placeholder has no supplied value, so a key that folds to its name
    // can only be one set to undefined.
    const undefinedKey = ownKeys.find((key) => key.toUpperCase() === bindName);
    if (undefinedKey !== undefined) {
      return new ServerError(
        `Raw SQL placeholder ${placeholder} has no value in params: key ${JSON.stringify(undefinedKey)} is undefined, which counts as absent; pass null to bind SQL NULL`
      );
    }
    const suppliedKeys = ownKeys.filter(
      (key) => suppliedParams[key] !== undefined
    );
    if (suppliedKeys.length === 0) {
      return new ServerError(
        `Raw SQL placeholder ${placeholder} has no value in params; supplied keys: none`
      );
    }
    const listedKeys = suppliedKeys
      .slice(0, DatabaseAdapter.MAX_LISTED_RAW_SQL_KEYS)
      .map((key) => JSON.stringify(key))
      .join(', ');
    const unlistedCount =
      suppliedKeys.length - DatabaseAdapter.MAX_LISTED_RAW_SQL_KEYS;
    const unlistedSuffix =
      unlistedCount > 0 ? ` and ${unlistedCount} more` : '';
    return new ServerError(
      `Raw SQL placeholder ${placeholder} has no value in params; supplied keys: ${listedKeys}${unlistedSuffix}`
    );
  }

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
   * Registers or replaces a serializer for driver result values.
   * @param options - serializer type and conversion strategy.
   */
  public setSerializer(options: TSetSerializer): void {
    this.serializer.setSerializer(options);
  }

  /**
   * Removes one serializer from the adapter registry.
   * @param serializerType - serializer type to remove.
   */
  public deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
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
   * Immutable snapshot of the serializer registry in canonical order; the same
   * object until the registry changes.
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
