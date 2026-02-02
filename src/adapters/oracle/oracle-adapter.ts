import { finished } from 'stream/promises';

import oracledb from 'oracledb';
import { DataSource } from 'typeorm';

import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { TConnectionMode } from '../../types/config.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { IProcedureArgumentList } from '../../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';
import { ServerError } from '../../utils/server-error.js';
import { TypeGuards } from '../../utils/type-guards.js';
import { DatabaseAdapter } from '../abstract/database-adapter.js';

import { OracleConnection } from './oracle-connection.js';
import { OracleNotify } from './oracle-notify.js';
import { OracleSerializer } from './oracle-serializer.js';
import { OracleSqlCommand } from './oracle-sql.js';

export class OracleAdapter extends DatabaseAdapter<
  OracleSerializer,
  OracleNotify,
  OracleConnection
> {
  public constructor(
    protected readonly appDataSource: DataSource,
    protected readonly logger: ILoggerModule,
    protected readonly handlerOptions: IRegisteredFetchHandlerOptions,
    protected readonly notifyPort?: number
  ) {
    const oracleConnection = new OracleConnection(appDataSource, logger);
    const oracleNotify = new OracleNotify(oracleConnection, logger, notifyPort);
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
    [this.CURSOR_TYPE]: oracledb.CURSOR,
    BUFFER: oracledb.BUFFER,
    DATE: oracledb.DATE,
    TIMESTAMP: oracledb.DB_TYPE_TIMESTAMP,
    CLOB: oracledb.CLOB,
    BLOB: oracledb.BLOB,
  } as const;
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
    if (!procedures?.[processName]) {
      throw new ServerError(
        `Package "${packageName}" or process "${processName}" not found`
      );
    }
    const functionParams = procedures[processName];
    const processBindings = (payload?: U): IBindingsObjectReturn => {
      const bindings: Array<oracledb.BindParameter> = [];
      const cursorsNames: Array<string> = [];
      const paramInputArray: Array<string> = [];

      functionParams.forEach((item, index) => {
        paramInputArray.push(`:${item.argumentName}`);
        if (item.argumentType === this.CURSOR_TYPE) {
          cursorsNames.push(item.argumentName);
          const dataType = item.argumentType.toUpperCase();
          if (!this.isValidDataType(dataType))
            throw new ServerError(`Invalid data type: ${dataType}`);
          bindings.push({
            dir: this.BINDING_DIR[item.mode as 'IN' | 'OUT' | 'IN/OUT'],
            type: this.TYPE_MAPPING[dataType],
          });
          return;
        }
        if (typeof payload === 'string' || typeof payload === 'number')
          throw new TypeError(
            'Payload for call procedure must be an object or array or undefined or null'
          );
        const normalizedName = item.argumentName.replace(/^p_/, '');
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
          const dataType = item.argumentType.toUpperCase();
          if (!this.isValidDataType(dataType))
            throw new ServerError(`Invalid data type: ${dataType}`);
          bindings.push({
            dir: this.BINDING_DIR[item.mode as 'IN' | 'OUT' | 'IN/OUT'],
            type: this.TYPE_MAPPING[dataType],
            val: value.length > 1 ? value.join(',') : value.toString(),
          });
          return;
        }
        const dataType = item.argumentType.toUpperCase();
        if (!this.isValidDataType(dataType))
          throw new ServerError(`Invalid data type: ${dataType}`);
        bindings.push({
          dir: this.BINDING_DIR[item.mode as 'IN' | 'OUT' | 'IN/OUT'],
          type: this.TYPE_MAPPING[dataType],
          val: value,
        });
      });
      const paramExecuteString = `BEGIN ${packageName}.${processName} (${paramInputArray.join(
        ','
      )}); END;`;
      return {
        bindings,
        cursorsNames,
        paramExecuteString,
      };
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
        paramsInUpperCase?.[(paramName as string).toUpperCase()] ?? null
      );
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

  /**
   * Generates a SQL query string to fetch the package info for a given package name.
   * @param packageName - name of the package to fetch info for
   * @returns SQL query string to fetch package info
   */
  public generatePackageInfoSql(packageName: string): string {
    return (
      OracleSqlCommand.SQL_GET_PACKAGE_INFO + `('${packageName.toUpperCase()}')`
    );
  }

  /**
   * Handles an Oracle query stream and returns the results as an array.
   * The stream is automatically destroyed when the function returns.
   * @param stream - Oracle query stream to handle
   * @returns Promise that resolves with the results of the stream as an array
   */
  private async handleQueryStream<T>(
    stream: oracledb.QueryStream<T>
  ): Promise<Array<T>> {
    const results: Array<T> = [];
    try {
      await finished(
        stream.on('data', (row: T) => {
          results.push(row);
        })
      );
    } finally {
      if (!stream.destroyed) {
        stream.destroy();
      }
    }

    return results;
  }

  /**
   * Fetches all the cursors from the given result set.
   *
   * This function takes an array of cursors names and an array of result sets.
   * It then fetches all the cursors from the result sets and returns them as an array.
   *
   * @param cursorsNames - names of the cursors to fetch
   * @param result - result set containing the cursors to fetch
   * @param _manager - database manager to use for the fetch, or undefined to use the default manager
   * @returns Promise that resolves with the fetched cursors as an array
   */
  protected async fetchAllCursors<T>(
    cursorsNames: Array<string>,
    result: Array<oracledb.ResultSet<T>>,
    _manager = undefined
  ): Promise<Array<T>> {
    let cursorResults: Array<T> = [];
    await Promise.all(
      cursorsNames.map(async (_, index) => {
        const stream = (result[index] as oracledb.ResultSet<T>).toQueryStream();
        cursorResults = cursorResults.concat(
          await this.handleQueryStream<T>(stream)
        );
      })
    );
    return cursorResults;
  }
  //? maybe this should be in the adapter abstract. I think this is overengeering.
  public getConnectionFromPool(
    mode?: TConnectionMode
  ): Promise<oracledb.Connection> {
    {
      return this.connection.getConnectionFromPool(mode);
    }
  }
  // ? maybe this should be in the adapter abstract. I think this is overengeering.
  public releaseConnectionFromPool(client: oracledb.Connection): Promise<void> {
    return this.connection.releaseConnectionFromPool(client);
  }
}
