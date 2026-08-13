import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import type { PostgresDriver } from '../../typeorm/driver/postgres/PostgresDriver.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import { replaceNamedParameters } from '../../typeorm/util/NamedParameterUtils.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
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
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { TypeGuards } from '../../utils/type-guards.js';
import { DatabaseAdapter } from '../abstract/database-adapter.js';

import { PostgreConnection } from './postgre-connection.js';
import { PostgreNotify } from './postgre-notify.js';
import { PostgreSerializer } from './postgre-serializer.js';
import { PostgreSqlCommand } from './postgre-sql.js';
export class PostgreAdapter extends DatabaseAdapter<
  PostgreSerializer,
  PostgreNotify,
  PostgreConnection
> {
  private refCursorType = 'refcursor' as const;

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
    protected readonly logger: ILoggerModule,
    protected readonly handlerOptions: IRegisteredFetchHandlerOptions,
    protected readonly listenEventName?: string
  ) {
    const postgreConnection = new PostgreConnection(appDataSource, logger);
    const postgreSerializer = new PostgreSerializer(logger, handlerOptions);
    const postgreNotify = new PostgreNotify(
      postgreConnection,
      logger,
      listenEventName
    );
    super(logger, postgreSerializer, postgreNotify, postgreConnection);
  }

  /**
   * Generates a SQL query that loads PostgreSQL procedure metadata from a schema.
   * @param packageName - schema name to inspect.
   * @returns SQL query string for procedure metadata loading.
   */
  public override generatePackageInfoSql(
    packageName: string,
    procedureMetadataSql?: string
  ): string {
    const safePackageName = SqlIdentifier.validateIdentifier(
      packageName,
      'postgres package'
    ).toLowerCase();
    return this.replacePackageNamePlaceholder(
      procedureMetadataSql ?? PostgreSqlCommand.SQL_GET_PACKAGE_INFO,
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
    const rows: Array<TRow> = [];
    const outBinds: Record<string, unknown> = {};
    const rawResult: unknown = executeResult.result;
    const firstResult: unknown = Array.isArray(rawResult)
      ? (rawResult as Array<unknown>)[0]
      : undefined;
    const scalarRecord =
      firstResult !== null && typeof firstResult === 'object'
        ? (firstResult as Record<string, unknown>)
        : {};

    for (const outBinding of outBindings) {
      const outName = outBinding.name;
      const outputName =
        this.handlerOptions.caseStrategy.transformColumnName(outName);
      if (!cursorsNames.includes(outName)) {
        const rawKey =
          Object.keys(scalarRecord).find(
            (key) =>
              key.toLowerCase() === outName.toLowerCase() || key === outputName
          ) ?? outName;
        outBinds[outputName] = scalarRecord[rawKey];
        continue;
      }
      const cursorResult = await executeResult.manager.query<Array<TRow>>(
        `FETCH ALL IN ${SqlIdentifier.quotePostgresIdentifier(outName)}`
      );
      try {
        outBinds[outputName] = cursorResult;
        for (const row of cursorResult) rows.push(row);
      } finally {
        await executeResult.manager.query(
          `CLOSE ${SqlIdentifier.quotePostgresIdentifier(outName)}`
        );
      }
    }
    return { rows, outBinds: this.asProcedureOut<TOut>(outBinds) };
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
    // Проверка наличия пакета и процедуры в списках
    if (!procedures?.[processName]) {
      throw new ServerError(
        `Package "${packageName}" or process "${processName}" not found`
      );
    }

    const functionParams = procedures[processName];

    const processBindings = (payload?: U): IBindingsObjectReturn => {
      const bindings: Array<unknown> = [];
      const cursorsNames: Array<string> = [];
      const outBindings: Array<IProcedureOutBinding> = [];
      functionParams.forEach((item, index) => {
        if (item.mode !== 'IN') {
          outBindings.push({
            name: item.argumentName,
            type:
              item.argumentType === this.refCursorType ? 'cursor' : 'scalar',
            databaseType: item.argumentType,
          });
        }
        if (item.argumentType === this.refCursorType) {
          cursorsNames.push(item.argumentName);
          bindings.push(item.argumentName);
          return;
        }
        const normalizedName = item.argumentName.replace(/^p_/, '');
        if (typeof payload === 'string' || typeof payload === 'number')
          throw new TypeError(
            'Payload for call procedure must be an object or array or undefined or null'
          );
        let value: unknown;
        if (Array.isArray(payload)) {
          value = payload[index] ?? null;
        } else if (payload && typeof payload === 'object' && payload !== null) {
          // TODO: In future fix types for payload.
          value =
            (payload as Record<string, unknown>)[normalizedName] ??
            (payload as Record<string, unknown>)[item.argumentName] ??
            null;
        } else {
          value = null;
        }

        if (Array.isArray(value)) {
          bindings.push(value.length > 1 ? value.join(',') : value.toString());
          return;
        }
        bindings.push(value);
      });
      const paramInputString = bindings.map((_, i) => `$${i + 1}`).join(',');
      const paramExecuteString = `CALL ${SqlIdentifier.quotePostgresQualifiedIdentifier(
        [packageName, processName]
      )}(${paramInputString})`;
      return {
        paramExecuteString,
        bindings,
        cursorsNames,
        outNames: outBindings.map(({ name }) => name),
        outBindings,
      };
    };
    if (TypeGuards.isNullOrUndefined(payload)) payload = {} as U;
    return processBindings(payload);
  }
  /**
   * Rewrites uppercase named placeholders to PostgreSQL positional bindings.
   * Example: `:ID` becomes `$1`.
   * @param sqlQuery - SQL query with uppercase named placeholders.
   * @param params - values keyed by placeholder name, case-insensitive.
   * @returns rewritten SQL and ordered binding values.
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
    let parameterIndex = 0;
    const sqlString = replaceNamedParameters(sqlQuery, ({ full, key }) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return full;
      bindings.push(paramsInUpperCase?.[(key ?? '').toUpperCase()] ?? null);
      parameterIndex += 1;
      return `$${parameterIndex}`;
    });
    return { bindings, sqlString: sqlString ?? '' };
  }
}
