import { finished } from 'stream/promises';

import oracledb from 'oracledb';

import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { OracleDriver } from '../../typeorm/driver/oracle/OracleDriver.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import { replaceNamedParameters } from '../../typeorm/util/NamedParameterUtils.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { IOracleOptionsNotify } from '../../types/notification.types.js';
import type {
  TProcedureArgumentList,
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../../types/procedure.types.js';
import type { TTemporalSerializerType } from '../../types/serializer.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
  IProcedureResult,
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';
import { DateFormatter } from '../../utils/date-formatter.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { TypeGuards } from '../../utils/type-guards.js';
import { DatabaseAdapter } from '../abstract/database-adapter.js';

import { OracleConnection } from './oracle-connection.js';
import { OracleNotify } from './oracle-notify.js';
import { OracleSerializer } from './oracle-serializer.js';
import { OracleSqlCommand } from './oracle-sql.js';

export class OracleAdapter extends DatabaseAdapter<
  OracleSerializer,
  OracleNotify,
  OracleConnection,
  IOracleOptionsNotify
> {
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule,
    protected readonly handlerOptions: IRegisteredFetchHandlerOptions
  ) {
    const oracleConnection = new OracleConnection(appDataSource, logger);
    const oracleNotify = new OracleNotify(oracleConnection, logger);
    const oracleSerializer = new OracleSerializer(logger, handlerOptions);
    super(logger, oracleSerializer, oracleNotify, oracleConnection);
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  }
  private CURSOR_TYPE = 'REF CURSOR' as const;
  private BINDING_DIR = {
    IN: oracledb.BIND_IN,
    OUT: oracledb.BIND_OUT,
    'IN/OUT': oracledb.BIND_INOUT,
  } as const;
  private TYPE_MAPPING = {
    NUMBER: oracledb.NUMBER,
    STRING: oracledb.STRING,
    VARCHAR2: oracledb.STRING,
    RAW: oracledb.BUFFER,
    [this.CURSOR_TYPE]: oracledb.CURSOR,
    BUFFER: oracledb.BUFFER,
    DATE: oracledb.DB_TYPE_DATE,
    TIMESTAMP: oracledb.DB_TYPE_TIMESTAMP,
    'TIMESTAMP WITH TIME ZONE': oracledb.DB_TYPE_TIMESTAMP_TZ,
    'TIMESTAMP WITH LOCAL TIME ZONE': oracledb.DB_TYPE_TIMESTAMP_LTZ,
    CLOB: oracledb.CLOB,
    BLOB: oracledb.BLOB,
  } as const;
  private readonly TEMPORAL_TYPES = new Set<string>([
    'DATE',
    'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE',
    'TIMESTAMP WITH LOCAL TIME ZONE',
  ]);
  private readonly VARIABLE_SIZE_OUT_TYPES = new Set<string>([
    'STRING',
    'VARCHAR2',
    'RAW',
  ]);
  private static readonly DEFAULT_PLSQL_OUT_MAX_SIZE = 32_767;
  private static readonly MINIMUM_OUT_MAX_SIZE = 201;

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

  /**
   * Creates Oracle PL/SQL procedure bindings from procedure metadata.
   *
   * Object payload keys may use either the raw argument name or the same name
   * without a leading `p_`. Arrays are bound by argument order. Oracle REF
   * CURSOR arguments are configured as output cursor bindings and returned in
   * cursorsNames.
   *
   * @param packageName - package name in lowercase.
   * @param processName - procedure name in lowercase.
   * @param procedures - procedure argument metadata map.
   * @param payload - object or array with input values, or undefined/null.
   * @returns object with:
   * - paramExecuteString: a string representing the SQL query with bindings
   * - bindings: an array of values to be passed to the procedure
   * - cursorsNames: an array of names of cursors (for Oracle only)
   */
  public override makeBindings<U extends TProcedurePayload = TProcedurePayload>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: TProcedurePayloadInput<U>
  ): IBindingsObjectReturn {
    if (!procedures?.[processName]) {
      throw new ServerError(
        `Package "${packageName}" or process "${processName}" not found`
      );
    }
    const functionParams = procedures[processName];
    const processBindings = (payload?: U): IBindingsObjectReturn => {
      const bindings: Record<string, oracledb.BindParameter> = {};
      const cursorsNames: Array<string> = [];
      const outBindings: Array<IProcedureOutBinding> = [];
      const paramInputArray: Array<string> = [];

      functionParams.forEach((item, index) => {
        SqlIdentifier.validateIdentifier(item.argumentName, 'oracle bind');
        paramInputArray.push(`:${item.argumentName}`);
        const dataType = item.argumentType.toUpperCase();
        if (!this.isValidDataType(dataType))
          throw new ServerError(`Invalid data type: ${dataType}`);
        if (item.mode !== 'IN') {
          outBindings.push({
            name: item.argumentName,
            type: dataType === this.CURSOR_TYPE ? 'cursor' : 'scalar',
            databaseType: dataType,
          });
        }
        if (dataType === this.CURSOR_TYPE) {
          cursorsNames.push(item.argumentName);
          bindings[item.argumentName] = {
            dir: this.BINDING_DIR[item.mode],
            type: this.TYPE_MAPPING[dataType],
          };
          return;
        }
        if (typeof payload === 'string' || typeof payload === 'number')
          throw new TypeError(
            'Payload for call procedure must be an object or array or undefined or null'
          );
        const normalizedName = item.argumentName.replace(/^p_/, '');
        let value: unknown;
        if (Array.isArray(payload)) {
          value = payload[index] ?? null;
        } else if (payload && typeof payload === 'object') {
          value =
            (payload as Record<string, unknown>)[normalizedName] ??
            (payload as Record<string, unknown>)[item.argumentName] ??
            null;
        } else {
          value = null;
        }

        if (this.TEMPORAL_TYPES.has(dataType) && item.mode !== 'OUT') {
          value = this.prepareTemporalInput(value, dataType, item.argumentName);
        } else if (Array.isArray(value)) {
          bindings[item.argumentName] = {
            dir: this.BINDING_DIR[item.mode],
            type: this.TYPE_MAPPING[dataType],
            val: value.length > 1 ? value.join(',') : value.toString(),
            ...(item.mode !== 'IN' && this.VARIABLE_SIZE_OUT_TYPES.has(dataType)
              ? { maxSize: this.getVariableOutMaxSize(item.size) }
              : {}),
          };
          return;
        }
        bindings[item.argumentName] = {
          dir: this.BINDING_DIR[item.mode],
          type: this.TYPE_MAPPING[dataType],
          ...(item.mode === 'OUT' ? {} : { val: value }),
          ...(item.mode !== 'IN' && this.VARIABLE_SIZE_OUT_TYPES.has(dataType)
            ? { maxSize: this.getVariableOutMaxSize(item.size) }
            : {}),
        };
      });
      const paramExecuteString = `BEGIN ${SqlIdentifier.formatOracleQualifiedIdentifier(
        [packageName, processName]
      )} (${paramInputArray.join(',')}); END;`;
      return {
        bindings,
        cursorsNames,
        outNames: outBindings.map(({ name }) => name),
        outBindings,
        paramExecuteString,
      };
    };
    if (TypeGuards.isNullOrUndefined(payload)) payload = {} as U;
    return processBindings(payload);
  }
  /**
   * Builds Oracle bindings for uppercase named placeholders.
   * Oracle keeps the original `:PARAM` placeholders in the SQL string and
   * receives the binding values in placeholder occurrence order.
   * @param sqlQuery - SQL query with uppercase named placeholders.
   * @param params - values keyed by placeholder name, case-insensitive.
   * @returns original SQL and ordered binding values.
   */
  public override makeSqlBindings<U extends Record<string, unknown>>(
    sqlQuery: string,
    params?: U
  ): ISqlBindingsObjectReturn {
    const bindings: Array<unknown> = [];
    const paramsInUpperCase = Object.fromEntries(
      params
        ? Object.entries(params).map(([key, value]) => {
            return [key.toUpperCase(), value];
          })
        : []
    );
    replaceNamedParameters(sqlQuery, ({ full, key }) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return full;
      bindings.push(paramsInUpperCase?.[(key as string).toUpperCase()] ?? null);
      return full;
    });
    return { bindings, sqlString: sqlQuery ?? '' };
  }
  /**
   * Checks if a given data type is valid for the current database adapter.
   * @param key - data type to check
   * @returns true if the data type is valid, false otherwise
   */
  private isValidDataType(key: string): key is keyof typeof this.TYPE_MAPPING {
    return key in this.TYPE_MAPPING;
  }

  private getVariableOutMaxSize(metadataSize?: number): number {
    const requestedSize =
      metadataSize ?? OracleAdapter.DEFAULT_PLSQL_OUT_MAX_SIZE;
    return Math.min(
      OracleAdapter.DEFAULT_PLSQL_OUT_MAX_SIZE,
      Math.max(OracleAdapter.MINIMUM_OUT_MAX_SIZE, requestedSize)
    );
  }

  /**
   * Strict fallback for temporal procedure inputs until the shared temporal
   * serializer exposes a bind-focused conversion API.
   */
  private prepareTemporalInput(
    value: unknown,
    dataType: string,
    argumentName: string
  ): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        throw new ServerError(
          `Invalid ${dataType} value for Oracle bind "${argumentName}"`
        );
      }
      return value;
    }
    if (typeof value === 'string') {
      const requiresZone =
        dataType === 'TIMESTAMP WITH TIME ZONE' ||
        dataType === 'TIMESTAMP WITH LOCAL TIME ZONE';
      const parsed = DateFormatter.parseSqlDate(value, {
        requireZone: requiresZone,
      }).toJSDate();
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    throw new ServerError(
      `Invalid ${dataType} value for Oracle bind "${argumentName}"`
    );
  }

  private isResultSet<T>(value: unknown): value is oracledb.ResultSet<T> {
    return (
      value !== null &&
      typeof value === 'object' &&
      'toQueryStream' in value &&
      typeof value.toQueryStream === 'function' &&
      'close' in value &&
      typeof value.close === 'function'
    );
  }

  private getResultSets<T>(
    values: Iterable<unknown>
  ): Set<oracledb.ResultSet<T>> {
    const resultSets = new Set<oracledb.ResultSet<T>>();
    for (const value of values) {
      if (this.isResultSet<T>(value)) resultSets.add(value);
    }
    return resultSets;
  }

  private async closePendingResultSets<T>(
    resultSets: ReadonlySet<oracledb.ResultSet<T>>
  ): Promise<void> {
    if (resultSets.size === 0) return;

    for (const resultSet of resultSets) {
      try {
        await resultSet.close();
      } catch (reason: unknown) {
        const error = reason instanceof Error ? reason.message : String(reason);
        this.logger.warn(`Failed to close Oracle result set: ${error}`);
      }
    }
  }

  /**
   * Generates a SQL query that loads Oracle package procedure metadata.
   * @param packageName - package name to inspect.
   * @returns SQL query string for procedure metadata loading.
   */
  public override generatePackageInfoSql(
    packageName: string,
    procedureMetadataSql?: string
  ): string {
    const safePackageName = SqlIdentifier.validateIdentifier(
      packageName,
      'oracle package'
    ).toUpperCase();
    return this.replacePackageNamePlaceholder(
      procedureMetadataSql ?? OracleSqlCommand.SQL_GET_PACKAGE_INFO,
      `'${safePackageName}'`
    );
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

  /**
   * Handles an Oracle query stream and returns the results as an array.
   * The stream is automatically destroyed when the function returns.
   * @param stream - Oracle query stream to handle
   * @returns Promise that resolves with the results of the stream as an array
   */
  private async handleQueryStream<T>(
    stream: oracledb.QueryStream<T>,
    transformRow?: (row: T) => T
  ): Promise<Array<T>> {
    const results: Array<T> = [];
    try {
      await finished(
        stream.on('data', (row: T) => {
          try {
            results.push(transformRow ? transformRow(row) : row);
          } catch (error: unknown) {
            stream.destroy(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        })
      );
    } finally {
      if (!stream.destroyed) {
        stream.destroy();
      }
    }

    return results;
  }

  private getResultSetMetadata<T>(
    resultSet: oracledb.ResultSet<T>
  ): Array<oracledb.Metadata<T>> {
    const candidate = resultSet as unknown;
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !('metaData' in candidate) ||
      !Array.isArray(candidate.metaData) ||
      !candidate.metaData.every(
        (metadata: unknown) =>
          metadata !== null &&
          typeof metadata === 'object' &&
          'name' in metadata &&
          typeof metadata.name === 'string'
      )
    ) {
      return [];
    }
    return candidate.metaData as Array<oracledb.Metadata<T>>;
  }

  private getTemporalSerializerType(
    metadata: oracledb.Metadata<unknown>
  ): TTemporalSerializerType | undefined {
    switch (metadata.dbType?.columnTypeName ?? metadata.dbTypeName) {
      case 'DATE':
        return 'DATE';
      case 'TIMESTAMP':
        return 'TIMESTAMP';
      case 'TIMESTAMP WITH TIME ZONE':
        return 'TIMESTAMP_TZ';
      case 'TIMESTAMP WITH LOCAL TIME ZONE':
        return 'TIMESTAMP_LTZ';
      default:
        return undefined;
    }
  }

  /**
   * REF CURSOR columns do not inherit the execute-level fetchTypeHandler in
   * node-oracledb. Apply the same case and temporal contract while the
   * ResultSet metadata is still available.
   */
  private transformCursorRow<T>(
    row: T,
    metadata: Array<oracledb.Metadata<T>>
  ): T {
    if (metadata.length === 0 || row === null || typeof row !== 'object') {
      return row;
    }

    const transformed: Record<string, unknown> = {};
    const rowArray = Array.isArray(row) ? (row as Array<unknown>) : undefined;
    const rowRecord = rowArray ? undefined : (row as Record<string, unknown>);
    metadata.forEach((column, index) => {
      const rawName = column.name;
      if (rowRecord && !(rawName in rowRecord)) return;
      const outputName =
        this.handlerOptions.caseStrategy.transformColumnName(rawName);
      const value = rowRecord ? rowRecord[rawName] : rowArray?.[index];
      const serializerType = this.getTemporalSerializerType(
        column as oracledb.Metadata<unknown>
      );
      transformed[outputName] = serializerType
        ? this.serializer.serializeValue(serializerType, value, {
            source: 'fetch',
            database: 'oracle',
            name: outputName,
            databaseType:
              column.dbType?.columnTypeName ?? column.dbTypeName ?? 'UNKNOWN',
          })
        : value;
    });
    return transformed as T;
  }

  /**
   * Fetches all the cursors from the given result set.
   *
   * Oracle returns REF CURSOR values as ResultSet instances. This method reads
   * each result set as a query stream and concatenates the rows.
   *
   * @param cursorsNames - output cursor names from procedure metadata.
   * @param result - result sets containing cursor rows.
   * @returns rows fetched from all cursors.
   */
  protected override async createProcedureResult<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    cursorsNames: Array<string>,
    outBindings: Array<IProcedureOutBinding>,
    executeResult: {
      result?: unknown;
    }
  ): Promise<IProcedureResult<TRow, TOut>> {
    const rows: Array<TRow> = [];
    const outBinds: Record<string, unknown> = {};
    const rawOutBinds = executeResult.result;
    if (
      rawOutBinds === null ||
      typeof rawOutBinds !== 'object' ||
      Array.isArray(rawOutBinds)
    ) {
      if (outBindings.length > 0) {
        throw new ServerError('Oracle out binds must be returned by name');
      }
      return { rows, outBinds: this.asProcedureOut<TOut>(outBinds) };
    }
    const rawRecord = rawOutBinds as Record<string, unknown>;
    const pendingResultSets = this.getResultSets<TRow>(
      Object.values(rawRecord)
    );
    try {
      for (const outBinding of outBindings) {
        const outName = outBinding.name;
        const rawKey =
          Object.keys(rawRecord).find(
            (key) => key.toLowerCase() === outName.toLowerCase()
          ) ?? outName;
        const rawValue = rawRecord[rawKey];
        const outputName =
          this.handlerOptions.caseStrategy.transformColumnName(outName);
        if (!cursorsNames.includes(outName)) {
          outBinds[outputName] = this.serializeScalarOut(
            outBinding,
            rawValue,
            outputName
          );
          continue;
        }
        if (!this.isResultSet<TRow>(rawValue)) {
          throw new ServerError(`Oracle cursor "${outName}" was not returned`);
        }
        const metadata = this.getResultSetMetadata(rawValue);
        const stream = rawValue.toQueryStream();
        pendingResultSets.delete(rawValue);
        const cursorRows = await this.handleQueryStream<TRow>(stream, (row) =>
          this.transformCursorRow(row, metadata)
        );
        outBinds[outputName] = cursorRows;
        for (const row of cursorRows) rows.push(row);
      }
    } finally {
      await this.closePendingResultSets<TRow>(pendingResultSets);
    }
    return { rows, outBinds: this.asProcedureOut<TOut>(outBinds) };
  }

  private serializeScalarOut(
    outBinding: IProcedureOutBinding,
    value: unknown,
    outputName: string
  ): unknown {
    const serializerType = ((): TTemporalSerializerType | undefined => {
      switch (outBinding.databaseType) {
        case 'DATE':
          return 'DATE';
        case 'TIMESTAMP':
          return 'TIMESTAMP';
        case 'TIMESTAMP WITH TIME ZONE':
          return 'TIMESTAMP_TZ';
        case 'TIMESTAMP WITH LOCAL TIME ZONE':
          return 'TIMESTAMP_LTZ';
        default:
          return undefined;
      }
    })();
    if (!serializerType) return value;
    return this.serializer.serializeValue(serializerType, value, {
      source: 'scalar-out',
      database: 'oracle',
      name: outputName,
      databaseType: outBinding.databaseType,
    });
  }
}
