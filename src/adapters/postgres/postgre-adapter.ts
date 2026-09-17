import { NO_ARGUMENT_SENTINEL } from '../../consts/procedure.consts.js';
import { replaceNamedParameters } from '../../typeorm/util/NamedParameterUtils.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { DatabaseAdapter } from '../abstract/database-adapter.js';

import { PostgreProcedureBindings } from './postgre-bindings.js';
import { PostgreConnection } from './postgre-connection.js';
import { PostgreNotify } from './postgre-notify.js';
import { PostgrePortalName } from './postgre-portal-name.js';
import { PostgreProcedureResultMaterializer } from './postgre-result-materializer.js';
import { PostgreSerializer } from './postgre-serializer.js';
import { PostgreSqlCommand } from './postgre-sql.js';

import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { PostgresDriver } from '../../typeorm/driver/postgres/PostgresDriver.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { INotifyRetryOptions } from '../../types/notification.types.js';
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
import type { Client } from 'pg';

export class PostgreAdapter extends DatabaseAdapter<
  PostgreSerializer,
  PostgreNotify,
  INotifyRetryOptions,
  Client
> {
  private readonly procedureBindings: PostgreProcedureBindings;
  private readonly resultMaterializer: PostgreProcedureResultMaterializer;

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
        vendor: 'PostgreSQL',
        noArgumentSentinel: NO_ARGUMENT_SENTINEL,
        getOverloadIdentity: ({ specificName }) => specificName,
      }
    );
  }

  public override registerFetchHandlerHook(): void {
    super.registerFetchHandlerHook();
    const driver = this.appDataSource.driver as unknown;
    if (
      driver === null ||
      typeof driver !== 'object' ||
      !('configureResultHandling' in driver) ||
      typeof driver.configureResultHandling !== 'function'
    ) {
      throw new ServerError(
        'PostgreSQL DataSource driver does not support instance result handling'
      );
    }
    const resultHandlingDriver = driver as Pick<
      PostgresDriver,
      'configureResultHandling'
    >;
    resultHandlingDriver.configureResultHandling(
      this.serializer.getTypeOverrides(),
      (rows, fields) => this.serializer.transformRows(rows, fields)
    );
  }

  public constructor(
    protected readonly appDataSource: DataSource,
    protected override readonly logger: ILoggerModule,
    protected readonly handlerOptions: IRegisteredFetchHandlerOptions,
    protected readonly listenEventName?: string
  ) {
    const postgreConnection = new PostgreConnection(appDataSource, logger);
    const postgreSerializer = new PostgreSerializer(logger, handlerOptions);
    const postgreNotify = new PostgreNotify(
      postgreConnection,
      logger,
      listenEventName,
      handlerOptions.resourceLimits?.maxNotificationQueue
    );
    super(logger, postgreSerializer, postgreNotify);
    const portalNames = new PostgrePortalName();
    this.procedureBindings = new PostgreProcedureBindings(
      portalNames,
      handlerOptions.caseStrategy
    );
    this.resultMaterializer = new PostgreProcedureResultMaterializer(
      logger,
      handlerOptions,
      portalNames,
      postgreSerializer
    );
  }

  /** Validates the schema name and lowercases it for the PostgreSQL catalog. */
  protected override normalizePackageIdentifier(packageName: string): string {
    return SqlIdentifier.validateIdentifier(
      packageName,
      'postgres package'
    ).toLowerCase();
  }

  /** Default SQL query that loads PostgreSQL procedure metadata from a schema. */
  protected override getDefaultPackageInfoSql(): string {
    return PostgreSqlCommand.SQL_GET_PACKAGE_INFO;
  }

  /** Appends the PostgreSQL `LIMIT` clause to a metadata query. */
  protected override applyMetadataRowLimit(
    query: string,
    detectionLimit: number
  ): string {
    return `${query.trimEnd()}\nLIMIT ${detectionLimit}`;
  }

  /** Builds the shared structured-type contract from PostgreSQL catalog rows. */
  public override prepareProcedureMetadataRows(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    return rows.map((row) => {
      if (row.structuredKind === null || row.structuredKind === undefined) {
        if (
          typeof row.argumentType === 'string' &&
          row.argumentType.trim().toLowerCase() === 'record'
        ) {
          throw new ServerError(
            'Dynamic PostgreSQL RECORD arguments are not supported; use a named composite type'
          );
        }
        return row;
      }
      return {
        ...row,
        structuredType: {
          kind: row.structuredKind,
          schema: row.structuredSchema,
          typeName: row.structuredTypeName,
          typeOid: row.structuredTypeOid,
          fields: row.structuredFields,
        },
      };
    });
  }

  /**
   * Fetches all rows from PostgreSQL refcursors and closes those cursors.
   * @param cursorsNames - refcursor names to fetch.
   * @param _result - unused raw procedure result.
   * @param manager - entity manager that owns the active transaction.
   * @returns concatenated rows from all cursors.
   */
  protected override async createProcedureResult<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    cursorsNames: Array<string>,
    outBindings: Array<IProcedureOutBinding>,
    executeResult: {
      manager: EntityManager;
      result?: unknown;
    }
  ): Promise<IProcedureResult<TRow, TOut>> {
    return this.resultMaterializer.materialize<TRow, TOut>(
      cursorsNames,
      outBindings,
      executeResult
    );
  }

  /**
   * Creates PostgreSQL CALL bindings from procedure metadata.
   *
   * Object payload keys may use either the raw argument name or the same name
   * without a leading `p_`. Arrays are bound by argument order. PostgreSQL
   * refcursor arguments are passed as cursor names and returned in cursorsNames.
   *
   * @param packageName - schema name in lowercase.
   * @param processName - procedure name in lowercase.
   * @param procedures - procedure argument metadata map.
   * @param payload - object or array with input values, or undefined/null.
   * @returns object with:
   * - paramExecuteString: a string representing the SQL query with bindings
   * - bindings: an array of values to be passed to the procedure
   * - cursorsNames: an array of PostgreSQL refcursor argument names to fetch after the call
   */
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
  /**
   * Rewrites uppercase named placeholders to PostgreSQL positional bindings.
   * Example: `:ID` becomes `$1`.
   * @param sqlQuery - SQL query with uppercase named placeholders.
   * @param params - values keyed by placeholder name, case-insensitive.
   * @returns rewritten SQL and ordered binding values.
   */
  public override makeSqlBindings(
    sqlQuery: string,
    params?: Record<string, unknown>
  ): ISqlBindingsObjectReturn {
    const bindings: Array<unknown> = [];
    const paramsInUpperCase = Object.fromEntries(
      params
        ? Object.entries(params).map(([key, value]) => {
            return [key.toUpperCase(), value];
          })
        : []
    );
    let parameterIndex = 0;
    const sqlString = replaceNamedParameters(sqlQuery, ({ full, key }) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return full;
      bindings.push(paramsInUpperCase[key.toUpperCase()] ?? null);
      parameterIndex += 1;
      return `$${parameterIndex}`;
    });
    return { bindings, sqlString: sqlString };
  }
}
