import type { PoolClient } from 'pg';
import { DataSource, EntityManager } from 'typeorm';

import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { TConnectionMode } from '../../types/config.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { IProcedureArgumentList } from '../../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';
import { TypeGuards } from '../../utils/type-guards.js';
import { DatabaseAdapter } from '../abstract/database-adapter.js';

import { PostgreConnection } from './postgre-connection.js';
import { PostgreNotify } from './postgre-notify.js';
import { PostgreSerializer } from './postgre-serializer.js';
import { PostgreSqlCommand } from './postgre-sql.js';
import { ServerError } from '../../utils/server-error.js';
export class PostgreAdapter extends DatabaseAdapter<
  PostgreSerializer,
  PostgreNotify,
  PostgreConnection
> {
  private refCursorType = 'refcursor' as const;

  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule,
    protected readonly handlerOptions: IRegisteredFetchHandlerOptions
  ) {
    const postgreConnection = new PostgreConnection(appDataSource, logger);
    const postgreSerializer = new PostgreSerializer(logger, handlerOptions);
    const postgreNotify = new PostgreNotify(postgreConnection, logger);
    super(logger, postgreSerializer, postgreNotify, postgreConnection);
  }

  /**
   * Generates a SQL query string to fetch the package info for a given package name.
   * @param packageName - name of the package to fetch info for
   * @returns SQL query string to fetch package info
   */
  public generatePackageInfoSql(packageName: string): string {
    return PostgreSqlCommand.SQL_GET_PACKAGE_INFO + ` '${packageName}';`;
  }

  /**
   * Fetches all rows from the given cursors.
   * After fetching the rows, the cursors are closed.
   * @param cursorsNames - names of the cursors to fetch from
   * @param [_result] - internal parameter to define the type of the result
   * @param manager - entity manager to use for the queries
   * @returns A promise that resolves with an array of the fetched rows
   */
  protected async fetchAllCursors<T>(
    cursorsNames: Array<string>,
    _result = undefined,
    manager: EntityManager
  ): Promise<Array<T>> {
    let cursorResults: Array<T> = [];
    await Promise.all(
      cursorsNames.map(async (cursorName) => {
        const cursorResult = await manager.query<Array<T>>(
          `FETCH ALL IN "${cursorName}"`
        );
        await manager.query(`CLOSE "${cursorName}"`);
        cursorResults = cursorResults.concat(cursorResult);
      })
    );
    return cursorResults;
  }

  /**
   * Creates bindings for a given SQL query or procedure call.
   *
   * @param packageName - name of the package (schema) in lowercase
   * @param processName - name of the procedure or SQL query in lowercase
   * @param procedures - list of procedure arguments
   * @param [payload] - object or array with data to be passed to the procedure, or undefined/null
   * @returns an object with the following properties:
   * - paramExecuteString: a string representing the SQL query with bindings
   * - bindings: an array of values to be passed to the procedure
   * - cursorsNames: an array of names of cursors (for Oracle only)
   */
  public makeBindings<U extends Record<string, unknown> | Array<unknown>>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: IProcedureArgumentList | undefined,
    payload?: U
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
      functionParams.forEach((item, index) => {
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
        if (payload && payload !== null && typeof payload === 'object') {
          value =
            (payload as Record<string, unknown>)[normalizedName] ??
            (payload as Record<string, unknown>)[item.argumentName] ??
            null;
        } else {
          value = Array.isArray(payload) ? (payload[index] ?? null) : null;
        }

        if (Array.isArray(value)) {
          bindings.push(value.length > 1 ? value.join(',') : value.toString());
          return;
        }
        bindings.push(value);
      });
      const paramInputString = bindings.map((_, i) => `$${i + 1}`).join(',');
      const paramExecuteString = `CALL ${packageName}.${processName}(${paramInputString})`;
      return { paramExecuteString, bindings, cursorsNames };
    };
    if (TypeGuards.isNullOrUndefined(payload)) payload = {} as U;
    return processBindings(payload);
  }
  /**
   * Makes SQL bindings for the given SQL query and parameters
   * @param {string} sqlQuery - SQL query string
   * @param {U} [params] - parameters for SQL query
   * @returns {ISqlBindingsObjectReturn} - object with bindings and modified SQL query string
   */
  public makeSqlBindings<U extends Record<string, unknown>>(
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
    const paramOccurrences = Array.from(
      sqlQuery.matchAll(/:([A-Z_][A-Z0-9_]*)\b/g)
    ).map(([, param]) => param);
    paramOccurrences.forEach((paramName) => {
      bindings.push(
        paramsInUpperCase?.[(paramName ?? '').toUpperCase()] ?? null
      );
    });

    const sqlString = paramOccurrences.reduce(
      (sql, paramName, index) =>
        (sql as string).replace(`:${paramName}`, `$${index + 1}`),
      sqlQuery
    );
    return { bindings, sqlString: sqlString ?? '' };
  }

  //? maybe this should be in the adapter abstract. I think this is overengeering.
  public getConnectionFromPool(mode?: TConnectionMode): Promise<PoolClient> {
    {
      return this.connection.getConnectionFromPool(mode);
    }
  }
  // ? maybe this should be in the adapter abstract. I think this is overengeering.
  public releaseConnectionFromPool(client: PoolClient): Promise<void> {
    return this.connection.releaseConnectionFromPool(
      client,
      this.releaseCallback
    );
  }
  private releaseCallback(client: PoolClient): void {
    client.removeAllListeners();
  }
}
