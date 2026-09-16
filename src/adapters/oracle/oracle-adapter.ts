import oracledb from 'oracledb';

import { replaceNamedParameters } from '../../typeorm/util/NamedParameterUtils.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../utils/resource-limits.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { DatabaseAdapter } from '../abstract/database-adapter.js';

import { OracleProcedureBindings } from './oracle-bindings.js';
import { OracleConnection } from './oracle-connection.js';
import { OracleNotify } from './oracle-notify.js';
import { OracleProcedureResultMaterializer } from './oracle-result-materializer.js';
import { OracleSerializer } from './oracle-serializer.js';
import { OracleSqlCommand } from './oracle-sql.js';

import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { OracleDriver } from '../../typeorm/driver/oracle/OracleDriver.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { IOracleOptionsNotify } from '../../types/notification.types.js';
import type {
  IProcedureArgumentBase,
  IProcedureStructuredField,
  IProcedureStructuredType,
  TProcedureArgumentList,
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
  IProcedureResult,
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';

/** Thin Oracle facade that wires vendor-specific adapter capabilities. */
export class OracleAdapter extends DatabaseAdapter<
  OracleSerializer,
  OracleNotify,
  IOracleOptionsNotify,
  oracledb.Connection
> {
  private static readonly NO_ARGUMENT_SENTINEL = '__tpk_no_argument__';
  private static readonly MINIMUM_RECORD_VERSION = [12, 1] as const;
  private static readonly RECORD_FIELD_TYPE_ALIASES = new Map([
    ['TIMESTAMP WITH TZ', 'TIMESTAMP WITH TIME ZONE'],
    ['TIMESTAMP WITH LOCAL TZ', 'TIMESTAMP WITH LOCAL TIME ZONE'],
  ]);
  private static readonly UNSUPPORTED_RECORD_FIELD_TYPES = new Set([
    'BFILE',
    'BLOB',
    'CLOB',
    'NCLOB',
    'OBJECT',
    'PL/SQL RECORD',
    'PL/SQL TABLE',
    'REF CURSOR',
    'TABLE',
    'VARRAY',
  ]);
  private readonly procedureBindings: OracleProcedureBindings;
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
    this.resultMaterializer = new OracleProcedureResultMaterializer(
      logger,
      handlerOptions,
      serializer
    );
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  }

  public override sortArgumentsAlgorithm(
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
      {
        vendor: 'Oracle',
        noArgumentSentinel: OracleAdapter.NO_ARGUMENT_SENTINEL,
        getOverloadIdentity: ({ overload, subprogramId }) =>
          overload ?? subprogramId,
      }
    );
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
   * Collects named bindings for uppercase placeholders, leaving the SQL text
   * untouched so Oracle keeps resolving `:NAME` itself.
   *
   * The bindings are returned as an object keyed by placeholder name rather
   * than as a positional array, because Oracle's bind slots are not positional
   * in a way the caller can predict: node-oracledb allocates one slot per
   * placeholder *occurrence* in plain SQL but only one per *distinct name* in
   * PL/SQL. A named object sidesteps that split entirely -- the driver matches
   * each value by name, fans it out to every occurrence of that name, and
   * rejects any name the statement does not declare -- so one entry per
   * distinct placeholder is correct for both statement kinds and no value can
   * ever land on a placeholder other than its own.
   * @param sqlQuery - SQL query with uppercase named placeholders.
   * @param params - values keyed by placeholder name, case-insensitive.
   * @returns the unchanged SQL and one binding value per distinct placeholder.
   */
  public override makeSqlBindings(
    sqlQuery: string,
    params?: Record<string, unknown>
  ): ISqlBindingsObjectReturn {
    const bindings: Record<string, unknown> = {};
    const paramsInUpperCase = Object.fromEntries(
      params
        ? Object.entries(params).map(([key, value]) => [
            key.toUpperCase(),
            value,
          ])
        : []
    );
    replaceNamedParameters(sqlQuery, ({ full, key }) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return full;
      const bindName = key.toUpperCase();
      if (Object.hasOwn(bindings, bindName)) return full;
      bindings[bindName] = paramsInUpperCase[bindName] ?? null;
      return full;
    });
    return { bindings, sqlString: sqlQuery };
  }

  public override generatePackageInfoSql(
    packageName: string,
    procedureMetadataSql?: string
  ): string {
    const safePackageName = SqlIdentifier.validateIdentifier(
      packageName,
      'oracle package'
    ).toUpperCase();
    const isModernMetadataSupported = this.isSupportedRecordVersion(
      this.appDataSource.driver.version
    );
    const defaultSql = isModernMetadataSupported
      ? OracleSqlCommand.SQL_GET_PACKAGE_INFO
      : OracleSqlCommand.SQL_GET_PACKAGE_INFO_LEGACY;
    const query = this.replacePackageNamePlaceholder(
      procedureMetadataSql ?? defaultSql,
      `'${safePackageName}'`
    );
    if (procedureMetadataSql) return query;
    const maxMetadataRows =
      this.handlerOptions.resourceLimits?.maxMetadataRows ??
      DEFAULT_RESOURCE_LIMITS.maxMetadataRows;
    const detectionLimit = Math.min(
      maxMetadataRows + 1,
      Number.MAX_SAFE_INTEGER
    );
    if (isModernMetadataSupported)
      return `${query.trimEnd()}\nFETCH FIRST ${detectionLimit} ROWS ONLY`;
    return `SELECT * FROM (\n${query.trimEnd()}\n) WHERE ROWNUM <= ${detectionLimit}`;
  }

  /** Combines a package RECORD argument with its dictionary field rows. */
  public override prepareProcedureMetadataRows(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    const preparedRows: Array<Record<string, unknown>> = [];
    let activeRecord: IProcedureStructuredType | undefined;

    for (const [index, row] of rows.entries()) {
      if (!Object.hasOwn(row, 'dataLevel')) {
        preparedRows.push(row);
        activeRecord = undefined;
        continue;
      }

      const dataLevel = this.readMetadataInteger(row.dataLevel, index, {
        name: 'dataLevel',
        minimum: 0,
      });
      if (dataLevel === 0) {
        activeRecord = undefined;
        const argumentType = this.readMetadataString(
          row.argumentType,
          index,
          'argumentType'
        ).toUpperCase();
        if (this.isCollectionType(argumentType, row.plsqlTypecode)) {
          throw new ServerError(
            `Oracle collection argument at metadata row ${index + 1} is not supported`
          );
        }
        if (!this.isRecordType(row)) {
          preparedRows.push(row);
          continue;
        }

        this.assertRecordVersionSupport();
        activeRecord = this.createRecordMetadata(row, index);
        preparedRows.push({ ...row, size: null, structuredType: activeRecord });
        continue;
      }

      if (!activeRecord) {
        throw new ServerError(
          `Oracle nested argument metadata row ${index + 1} has no package RECORD parent`
        );
      }
      if (dataLevel !== 1) {
        throw new ServerError(
          `Oracle nested RECORD fields are not supported (metadata row ${index + 1})`
        );
      }
      activeRecord.fields.push(this.createRecordFieldMetadata(row, index));
    }

    for (const [index, row] of preparedRows.entries()) {
      const structuredType = row.structuredType;
      if (
        structuredType !== null &&
        typeof structuredType === 'object' &&
        !Array.isArray(structuredType) &&
        (structuredType as { kind?: unknown }).kind === 'oracle-record' &&
        (structuredType as IProcedureStructuredType).fields.length === 0
      ) {
        throw new ServerError(
          `Oracle package RECORD at prepared metadata row ${index + 1} has no fields`
        );
      }
    }
    return preparedRows;
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

  private replacePackageNamePlaceholder(
    sql: string,
    packageNameLiteral: string
  ): string {
    if (!sql.includes(':PACKAGE_NAME')) {
      throw new ServerError(
        'Procedure metadata SQL must contain :PACKAGE_NAME placeholder'
      );
    }
    return sql.split(':PACKAGE_NAME').join(packageNameLiteral);
  }

  private createRecordMetadata(
    row: Record<string, unknown>,
    index: number
  ): IProcedureStructuredType {
    const owner = this.readMetadataString(row.typeOwner, index, 'typeOwner');
    const packageName = this.readMetadataString(
      row.typeName,
      index,
      'typeName'
    );
    const typeName = this.readMetadataString(
      row.typeSubname,
      index,
      'typeSubname'
    );
    if (
      owner.includes('%ROWTYPE') ||
      packageName.includes('%ROWTYPE') ||
      typeName.includes('%ROWTYPE')
    ) {
      throw new ServerError(
        'Oracle PL/SQL %ROWTYPE arguments are not supported'
      );
    }
    SqlIdentifier.validateIdentifier(owner, 'oracle record owner');
    SqlIdentifier.validateIdentifier(packageName, 'oracle record package');
    SqlIdentifier.validateIdentifier(typeName, 'oracle record type');
    return {
      kind: 'oracle-record',
      owner,
      packageName,
      typeName,
      fields: [],
    };
  }

  private createRecordFieldMetadata(
    row: Record<string, unknown>,
    index: number
  ): IProcedureStructuredField {
    const name = this.readMetadataString(
      row.argumentName,
      index,
      'argumentName'
    );
    const dictionaryType = this.readMetadataString(
      row.argumentType,
      index,
      'argumentType'
    ).toUpperCase();
    // Object attribute metadata abbreviates time zones, unlike ALL_ARGUMENTS.
    const argumentType =
      OracleAdapter.RECORD_FIELD_TYPE_ALIASES.get(dictionaryType) ??
      dictionaryType;
    const order = this.readMetadataInteger(row.sequence, index, {
      name: 'sequence',
      minimum: 0,
    });
    SqlIdentifier.validateIdentifier(name, 'oracle record field');
    if (
      OracleAdapter.UNSUPPORTED_RECORD_FIELD_TYPES.has(argumentType) ||
      argumentType.includes('%ROWTYPE') ||
      row.typeOwner != null ||
      row.typeName != null ||
      row.typeSubname != null
    ) {
      throw new ServerError(
        `Oracle RECORD field "${name}" uses unsupported type ${argumentType}`
      );
    }
    return { name, argumentType, order };
  }

  private isRecordType(row: Record<string, unknown>): boolean {
    const typeCode =
      typeof row.plsqlTypecode === 'string'
        ? row.plsqlTypecode.trim().toUpperCase()
        : undefined;
    return typeCode === 'PL/SQL RECORD' || typeCode === 'RECORD';
  }

  private isCollectionType(
    argumentType: string,
    rawTypeCode: unknown
  ): boolean {
    const typeCode =
      typeof rawTypeCode === 'string'
        ? rawTypeCode.trim().toUpperCase()
        : undefined;
    return (
      typeCode === 'COLLECTION' ||
      argumentType === 'PL/SQL TABLE' ||
      argumentType === 'TABLE' ||
      argumentType === 'VARRAY'
    );
  }

  private readMetadataString(
    value: unknown,
    index: number,
    name: string
  ): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ServerError(
        `Invalid Oracle metadata row ${index + 1}: ${name} must be a non-empty string`
      );
    }
    return value.trim();
  }

  private readMetadataInteger(
    value: unknown,
    index: number,
    options: { name: string; minimum: number }
  ): number {
    const parsed =
      typeof value === 'number' ||
      (typeof value === 'string' && value.trim().length > 0)
        ? Number(value)
        : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < options.minimum) {
      throw new ServerError(
        `Invalid Oracle metadata row ${index + 1}: ${options.name} must be a safe integer greater than or equal to ${options.minimum}`
      );
    }
    return parsed;
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
