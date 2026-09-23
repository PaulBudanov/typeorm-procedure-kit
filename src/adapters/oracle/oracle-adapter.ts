import oracledb from 'oracledb';

import { NO_ARGUMENT_SENTINEL } from '../../consts/procedure.consts.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { DatabaseAdapter } from '../abstract/database-adapter.js';

import { OracleProcedureBindings } from './oracle-bindings.js';
import { OracleConnection } from './oracle-connection.js';
import { OracleNotify } from './oracle-notify.js';
import { OracleRecordMetadataParser } from './oracle-record-metadata-parser.js';
import { OracleProcedureResultMaterializer } from './oracle-result-materializer.js';
import { OracleSerializer } from './oracle-serializer.js';
import { OracleSqlCommand } from './oracle-sql.js';

import type { IProcedureMetadataOptions } from '../../interfaces/procedure-metadata-normalizer.interfaces.js';
import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { OracleDriver } from '../../typeorm/driver/oracle/OracleDriver.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { IOracleOptionsNotify } from '../../types/notification.types.js';
import type {
  TProcedureArgumentList,
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
  IProcedureResult,
} from '../../types/utility.types.js';

/** Thin Oracle facade that wires vendor-specific adapter capabilities. */
export class OracleAdapter extends DatabaseAdapter<
  OracleSerializer,
  OracleNotify,
  IOracleOptionsNotify,
  oracledb.Connection
> {
  private static readonly MINIMUM_RECORD_VERSION = [12, 1] as const;
  protected override readonly procedureMetadataOptions: IProcedureMetadataOptions =
    {
      vendor: 'Oracle',
      noArgumentSentinel: NO_ARGUMENT_SENTINEL,
      getOverloadIdentity: ({ overload, subprogramId }) =>
        overload ?? subprogramId,
    };
  private readonly procedureBindings: OracleProcedureBindings;
  private readonly recordMetadataParser: OracleRecordMetadataParser;
  private readonly resultMaterializer: OracleProcedureResultMaterializer;

  public constructor(
    protected readonly appDataSource: DataSource,
    protected override readonly logger: ILoggerModule,
    protected readonly handlerOptions: IRegisteredFetchHandlerOptions
  ) {
    const connection = new OracleConnection(appDataSource, logger);
    const notifier = new OracleNotify(
      connection,
      logger,
      handlerOptions.resourceLimits?.maxNotificationQueue,
      handlerOptions.resourceLimits?.maxNotificationRows
    );
    const serializer = new OracleSerializer(logger, handlerOptions);
    super(logger, serializer, notifier);
    this.procedureBindings = new OracleProcedureBindings();
    this.recordMetadataParser = new OracleRecordMetadataParser((): void => {
      this.assertRecordVersionSupport();
    });
    this.resultMaterializer = new OracleProcedureResultMaterializer(
      logger,
      handlerOptions,
      serializer
    );
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  }

  public override async execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: Array<string>,
    bindings: IBindingsObjectReturn['bindings'] = [],
    cursorsNames: Array<string> = []
  ): Promise<Awaited<Array<T>>> {
    this.assertNoPersistentTimeZoneOverride(optionsCommands);
    return super.execute<T>(
      sql,
      client,
      optionsCommands,
      bindings,
      cursorsNames
    );
  }

  public override async executeProcedure<
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
    this.assertNoPersistentTimeZoneOverride(optionsCommands);
    return super.executeProcedure<TRow, TOut>(
      sql,
      client,
      optionsCommands,
      bindings,
      cursorsNames,
      outBindings
    );
  }

  public override registerFetchHandlerHook(): void {
    super.registerFetchHandlerHook();
    const driver = this.appDataSource.driver as unknown;
    if (
      driver === null ||
      typeof driver !== 'object' ||
      !('setFetchTypeHandler' in driver) ||
      typeof driver.setFetchTypeHandler !== 'function'
    ) {
      throw new ServerError(
        'Oracle DataSource driver does not support instance fetch handlers'
      );
    }
    const fetchHandlerDriver = driver as Pick<
      OracleDriver,
      'setFetchTypeHandler'
    >;
    fetchHandlerDriver.setFetchTypeHandler(
      this.serializer.createFetchTypeHandler()
    );
  }

  public override makeBindings<U extends TProcedurePayload = TProcedurePayload>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: TProcedurePayloadInput<U>
  ): IBindingsObjectReturn {
    if (
      procedures &&
      Object.hasOwn(procedures, processName) &&
      procedures[processName]?.some(
        ({ structuredType }) => structuredType?.kind === 'oracle-record'
      )
    ) {
      this.assertRecordVersionSupport();
    }
    return this.procedureBindings.build(
      packageName,
      processName,
      procedures,
      payload
    );
  }

  /**
   * Leaves the placeholder in the SQL text so Oracle keeps resolving `:NAME`
   * itself.
   * @param placeholder - the placeholder exactly as written.
   * @returns the placeholder unchanged.
   */
  protected override renderRawSqlPlaceholder(placeholder: string): string {
    return placeholder;
  }

  /**
   * Collects one named binding per distinct placeholder, keyed by its
   * uppercase bind name.
   *
   * The bindings are returned as an object keyed by placeholder name rather
   * than as a positional array, because Oracle's bind slots are not positional
   * in a way the caller can predict: node-oracledb allocates one slot per
   * placeholder *occurrence* in plain SQL but only one per *distinct name* in
   * PL/SQL. A named object sidesteps that split entirely -- the driver matches
   * each value by name, fans it out to every occurrence of that name, and
   * rejects any name the statement does not declare -- so one entry per
   * distinct placeholder is correct for both statement kinds and no value can
   * ever land on a placeholder other than its own. The driver uppercases an
   * unquoted bind name both in the SQL text and in the bind object, so the
   * uppercase key serves `:userId` exactly as it serves `:USERID`.
   * @param placeholders - bound occurrences with their uppercase bind names.
   * @returns one binding value per distinct placeholder name.
   */
  protected override collectRawSqlBindings(
    placeholders: Array<[bindName: string, value: unknown]>
  ): Record<string, unknown> {
    return Object.fromEntries(placeholders);
  }

  /** Delegates the Oracle dictionary row folding to the record parser. */
  public override prepareProcedureMetadataRows(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    return this.recordMetadataParser.prepareRows(rows);
  }

  /** Validates the package name and uppercases it for the Oracle dictionary. */
  protected override normalizePackageIdentifier(packageName: string): string {
    return SqlIdentifier.validateIdentifier(
      packageName,
      'oracle package'
    ).toUpperCase();
  }

  /**
   * Reads the server version once and picks dictionary query and row-limit
   * form together: the package type query with `FETCH FIRST` on Oracle 12.1
   * and newer, and the legacy `ALL_ARGUMENTS` query wrapped in a `ROWNUM`
   * filter on older releases, which lack row-limiting clauses.
   * @param detectionLimit - maximum number of rows the query may return.
   * @returns metadata SQL template limited with the matching Oracle syntax.
   */
  protected override buildDefaultPackageInfoSql(
    detectionLimit: number
  ): string {
    if (this.isModernMetadataSupported())
      return `${OracleSqlCommand.SQL_GET_PACKAGE_INFO.trimEnd()}\nFETCH FIRST ${detectionLimit} ROWS ONLY`;
    return `SELECT * FROM (\n${OracleSqlCommand.SQL_GET_PACKAGE_INFO_LEGACY.trimEnd()}\n) WHERE ROWNUM <= ${detectionLimit}`;
  }

  /** True when the connected Oracle release supports the modern metadata SQL. */
  private isModernMetadataSupported(): boolean {
    return this.isSupportedRecordVersion(this.appDataSource.driver.version);
  }

  protected override createProcedureResult<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    cursorsNames: Array<string>,
    outBindings: Array<IProcedureOutBinding>,
    executeResult: { result?: unknown }
  ): Promise<IProcedureResult<TRow, TOut>> {
    return this.resultMaterializer.materialize<TRow, TOut>(
      cursorsNames,
      outBindings,
      executeResult.result
    );
  }

  private assertNoPersistentTimeZoneOverride(commands: Array<string>): void {
    const timeZoneCommand = commands.find(
      (command) =>
        /\bALTER\s+SESSION\b/i.test(command) && /\bTIME_ZONE\b/i.test(command)
    );
    if (timeZoneCommand) {
      throw new ServerError(
        'Oracle optionsCommands cannot override TIME_ZONE because ALTER SESSION state persists after the connection returns to the pool. Configure sessionTimeZone instead.'
      );
    }
  }

  private assertRecordVersionSupport(): void {
    const databaseVersion = this.appDataSource.driver.version;
    if (!this.isSupportedRecordVersion(databaseVersion)) {
      throw new ServerError(
        `Oracle PL/SQL RECORD requires Oracle Database 12.1 or newer; detected ${databaseVersion ?? 'unknown'}`
      );
    }
    if (
      !oracledb.thin &&
      !this.isSupportedRecordVersion(oracledb.oracleClientVersionString)
    ) {
      throw new ServerError(
        `Oracle PL/SQL RECORD requires Oracle Client 12.1 or newer; detected ${oracledb.oracleClientVersionString}`
      );
    }
  }

  private isSupportedRecordVersion(version: string | undefined): boolean {
    if (!version) return false;
    const [majorText, minorText = '0'] = version.split('.');
    const major = Number(majorText);
    const minor = Number(minorText);
    if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) {
      return false;
    }
    const [minimumMajor, minimumMinor] = OracleAdapter.MINIMUM_RECORD_VERSION;
    return (
      major > minimumMajor || (major === minimumMajor && minor >= minimumMinor)
    );
  }
}
