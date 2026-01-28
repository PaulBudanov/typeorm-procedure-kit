import { finished } from 'stream/promises';

import oracledb from 'oracledb';
import { DataSource, EntityManager } from 'typeorm';

import type {
  IBindingsObjectReturn,
  ILoggerModule,
  IProcedureArgumentList,
  IProcedureArgumentOracle,
  ISqlBindingsObjectReturn,
  TOptionsCommand,
  TOracleUtils,
} from '../../types.js';
import { callDataBaseOptionsCommands } from '../../utils/callDataBaseOptionsCommands.js';
import { isNullOrUndefined } from '../../utils/isNullOrUndefined.js';

import { OracleSerializer } from './oracle-serializer.js';
import { OracleSqlCommand } from './oracle-sql.js';

export class OracleUtils extends OracleSerializer implements TOracleUtils {
  /**
   * Constructor for OracleUtils class.
   * Initializes the OracleUtils object with the provided configuration
   * and logger. Also sets up the Oracle out format to be object.
   * @param {DataSource} appDataSource - configuration for the Oracle connection
   * @param {ILoggerModule} logger - logger module to log messages
   * @param {number} notifyPort - port number for the notification listener
   */
  public constructor(
    protected appDataSource: DataSource,
    protected logger: ILoggerModule,
    protected notifyPort: number,
  ) {
    super(appDataSource, logger, notifyPort);
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
    payload?: U,
  ): IBindingsObjectReturn {
    if (!procedures?.[processName]) {
      throw new Error(
        `Package "${packageName}" or process "${processName}" not found`,
      );
    }
    const functionParams = procedures[processName];
    const processBindings = (payload?: U) => {
      const bindings: Array<oracledb.BindParameter> = [];
      const cursorsNames: Array<string> = [];
      const paramInputArray: Array<string> = [];

      functionParams.forEach((item, index) => {
        paramInputArray.push(`:${item.argument_name}`);
        if (item.argument_type === this.CURSOR_TYPE) {
          cursorsNames.push(item.argument_name);
          const dataType = item.argument_type.toUpperCase();
          if (!this.isValidDataType(dataType))
            throw new Error(`Invalid data type: ${dataType}`);
          bindings.push({
            dir: this.BINDING_DIR[item.mode as 'IN' | 'OUT' | 'IN/OUT'],
            type: this.TYPE_MAPPING[dataType],
          });
          return;
        }
        if (typeof payload === 'string' || typeof payload === 'number')
          throw new TypeError(
            'Payload for call procedure must be an object or array or undefined or null',
          );
        const normalizedName = item.argument_name.replace(/^p_/, '');
        let value: unknown;
        if (payload && payload !== null && typeof payload === 'object') {
          value =
            (payload as Record<string, unknown>)[normalizedName] ??
            (payload as Record<string, unknown>)[item.argument_name] ??
            null;
        } else {
          value = Array.isArray(payload) ? (payload[index] ?? null) : null;
        }

        if (Array.isArray(value)) {
          const dataType = item.argument_type.toUpperCase();
          if (!this.isValidDataType(dataType))
            throw new Error(`Invalid data type: ${dataType}`);
          bindings.push({
            dir: this.BINDING_DIR[item.mode as 'IN' | 'OUT' | 'IN/OUT'],
            type: this.TYPE_MAPPING[dataType],
            val: value.length > 1 ? value.join(',') : value.toString(),
          });
          return;
        }
        const dataType = item.argument_type.toUpperCase();
        if (!this.isValidDataType(dataType))
          throw new Error(`Invalid data type: ${dataType}`);
        bindings.push({
          dir: this.BINDING_DIR[item.mode as 'IN' | 'OUT' | 'IN/OUT'],
          type: this.TYPE_MAPPING[dataType],
          val: value,
        });
      });
      const paramExecuteString = `BEGIN ${packageName}.${processName} (${paramInputArray.join(
        ',',
      )}); END;`;
      return {
        bindings,
        cursorsNames,
        paramExecuteString,
      };
    };
    if (isNullOrUndefined(payload)) payload = {} as U;
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
    params?: U,
  ): ISqlBindingsObjectReturn {
    const bindings: Array<unknown> = [];
    const paramsInUpperCase = Object.fromEntries(
      params
        ? Object.entries(params).map(([key, value]) => {
            return [key.toUpperCase(), value];
          })
        : [],
    );
    const paramOccurrences = Array.from(
      sqlQuery.matchAll(/:([A-Z_][A-Z0-9_]*)\b/g),
    ).map(([, param]) => param);
    paramOccurrences.forEach((paramName) => {
      bindings.push(paramsInUpperCase?.[paramName.toUpperCase()] ?? null);
    });
    return { bindings, sqlString: sqlQuery };
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

  //TODO: Add logic for get info about specific procedure
  public generatePackageInfoSqlSpecific(
    _packageName: string,
    _procedureName: string,
  ): string {
    return '';
  }
  /**
   * Handles an Oracle query stream and returns the results as an array.
   * The stream is automatically destroyed when the function returns.
   * @param stream - Oracle query stream to handle
   * @returns Promise that resolves with the results of the stream as an array
   */
  private async _handleQueryStream<T>(
    stream: oracledb.QueryStream<T>,
  ): Promise<Array<T>> {
    const results: Array<T> = [];
    try {
      await finished(
        stream.on('data', (row: T) => {
          results.push(row);
        }),
      );
    } finally {
      if (!stream.destroyed) {
        stream.destroy();
      }
    }

    return results;
  }
  /**
   * Sorts the arguments for a given procedure in a package.
   * Removes any procedures that are not present in the procedureListBase array.
   * If the package does not exist in the procedureListBase array and there are multiple packages,
   * the procedure is skipped.
   * Sorts the arguments by their position.
   * @param rawArguments - array of raw arguments for the procedure
   * @param procedureListBase - array of procedures in the package
   * @param packageName - name of the package
   * @param packagesLength - length of the packages array
   * @returns sorted arguments for the procedure
   */
  public sortArgumentsAlgorithm(
    rawArguments: Array<IProcedureArgumentOracle>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number,
  ): IProcedureArgumentList {
    const sortedProcedures = rawArguments.reduce(
      (acc: IProcedureArgumentList, item: IProcedureArgumentOracle) => {
        const itemObjectNameToLowerCase =
          item.procedure_name.toLowerCase() as Lowercase<string>;
        if (
          item.argument_name === undefined ||
          item.argument_name === null ||
          (!procedureListBase.includes(
            `${packageName}.${itemObjectNameToLowerCase}` as Lowercase<string>,
          ) &&
            packagesLength > 1)
        )
          return acc;
        acc[itemObjectNameToLowerCase] = acc[itemObjectNameToLowerCase] ?? [];
        acc[itemObjectNameToLowerCase].push({
          argument_name: item.argument_name.toLowerCase(),
          argument_type: item.argument_type,
          order: item.order,
          mode: item.mode,
        });
        acc[itemObjectNameToLowerCase].sort((a, b) => a.order - b.order);

        return acc;
      },
      {} as IProcedureArgumentList,
    );
    return sortedProcedures;
  }

  /**
   * Execute a SQL query or procedure call in a transaction
   * @param {string} sql - SQL query string
   * @param {EntityManager} client - database connection
   * @param {TOptionsCommand['oracle']} optionsCommands - options for database commands
   * @param {IBindingsObjectReturn['bindings']} [bindings] - parameters for SQL query
   * @param {Array<string>} [cursorsNames] - names of cursors
   * @returns {Promise<Awaited<Array<T>>>} - result of SQL query call
   */
  public async execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: TOptionsCommand['oracle'],
    bindings: IBindingsObjectReturn['bindings'] = [],
    cursorsNames: Array<string> = [],
  ): Promise<Awaited<Array<T>>> {
    return client.transaction(async (manager) => {
      if (optionsCommands && optionsCommands.length > 0) {
        await callDataBaseOptionsCommands(optionsCommands, manager);
      }
      // console.log(sql, bindings);
      const result = await manager.query<Array<T | oracledb.ResultSet<T>>>(
        sql,
        bindings,
      );
      // console.log(cursorsNames);
      const isCursorResult =
        Array.isArray(result) &&
        result.length > 0 &&
        typeof result[0] === 'object' &&
        result !== null &&
        cursorsNames.length > 0;
      if (isCursorResult) {
        let cursorResults: Array<T> = [];
        await Promise.all(
          cursorsNames.map(async (_, index) => {
            const stream = (
              result[index] as oracledb.ResultSet<T>
            ).toQueryStream();
            cursorResults = cursorResults.concat(
              await this._handleQueryStream<T>(stream),
            );
          }),
        );
        // console.log(cursorResults);
        return cursorResults;
      }
      return result as Array<T>;
    });
  }
}
