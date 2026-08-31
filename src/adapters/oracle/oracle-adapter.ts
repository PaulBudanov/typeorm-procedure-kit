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
        includeAllWhenSinglePackage: true,
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
    return this.procedureBindings.build(
      packageName,
      processName,
      procedures,
      payload
    );
  }

  public override makeSqlBindings(
    sqlQuery: string,
    params?: Record<string, unknown>
  ): ISqlBindingsObjectReturn {
    const bindings: Array<unknown> = [];
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
      bindings.push(paramsInUpperCase[key.toUpperCase()] ?? null);
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
    const query = this.replacePackageNamePlaceholder(
      procedureMetadataSql ?? OracleSqlCommand.SQL_GET_PACKAGE_INFO,
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
    const oracleVersion = this.appDataSource.driver.version;
    if (oracleVersion && parseInt(oracleVersion, 10) < 12)
      return `SELECT * FROM (${query.trimEnd()}) WHERE ROWNUM <= ${detectionLimit}`;
    return `${query.trimEnd()}\nFETCH FIRST ${detectionLimit} ROWS ONLY`;
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
}
