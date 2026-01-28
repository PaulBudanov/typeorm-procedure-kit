// import { type ClientConfig } from 'pg';
import { DataSource, EntityManager } from 'typeorm';

import type {
  IBindingsObjectReturn,
  ILoggerModule,
  IProcedureArgumentList,
  IProcedureArgumentPostgre,
  ISqlBindingsObjectReturn,
  TOptionsCommand,
  TPostgresUtils,
} from '../../types.js';
import { callDataBaseOptionsCommands } from '../../utils/callDataBaseOptionsCommands.js';
import { isNullOrUndefined } from '../../utils/isNullOrUndefined.js';

import { PostgreSerializer } from './postgre-serializer.js';
import { PostgreSqlCommand } from './postgre-sql.js';
export class PostgreUtils extends PostgreSerializer implements TPostgresUtils {
  private refCursorType = 'refcursor' as const;

  public constructor(
    // protected clientConfig: ClientConfig,
    protected appDataSource: DataSource,
    protected logger: ILoggerModule,
  ) {
    super(appDataSource, logger);
  }

  /**
   * Generates a SQL query string to fetch the package info for a given package name.
   * @param packageName - name of the package to fetch info for
   * @returns SQL query string to fetch package info
   */
  public generatePackageInfoSql(packageName: string): string {
    return PostgreSqlCommand.SQL_GET_PACKAGE_INFO + ` '${packageName}';`;
  }

  //TODO: Add logic for get info about specific procedure
  public generatePackageInfoSqlSpecific(
    _packageName: string,
    _procedureName: string,
  ): string {
    return '';
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
    rawArguments: Array<IProcedureArgumentPostgre>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number,
  ): IProcedureArgumentList {
    const sortedProcedures = rawArguments.reduce(
      (acc: IProcedureArgumentList, item: IProcedureArgumentPostgre) => {
        // console.log(item);
        const itemObjectNameToLowerCase =
          item.procedure_name.toLowerCase() as Lowercase<string>;
        if (
          !procedureListBase.includes(
            `${packageName}.${itemObjectNameToLowerCase}` as Lowercase<string>,
          ) &&
          packagesLength > 1
        ) {
          return acc;
        }
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
   * Execute a SQL query in a transaction
   * @param {string} sql - SQL query string
   * @param {EntityManager} client - database connection
   * @param {TOptionsCommand['postgres']} optionsCommands - options for database commands
   * @param {IBindingsObjectReturn['bindings']} [bindings] - parameters for SQL query
   * @param {Array<string>} [cursorsNames] - names of cursors
   * @returns {Promise<Awaited<Array<T>>>} - result of SQL query call
   */
  public async execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: TOptionsCommand['postgres'],
    bindings: IBindingsObjectReturn['bindings'] = [],
    cursorsNames: Array<string> = [],
  ): Promise<Awaited<Array<T>>> {
    return client.transaction(async (manager) => {
      if (optionsCommands && optionsCommands.length > 0) {
        await callDataBaseOptionsCommands(optionsCommands, manager);
      }
      const result = await manager.query<Array<T>>(sql, bindings);
      if (
        cursorsNames.length > 0 &&
        Array.isArray(result) &&
        result.length > 0
      ) {
        let cursorResults: Array<T> = [];
        await Promise.all(
          cursorsNames.map(async (cursorName) => {
            const cursorResult = await manager.query<Array<T>>(
              `FETCH ALL IN "${cursorName}"`,
            );
            await client.query(`CLOSE "${cursorName}"`);
            cursorResults = cursorResults.concat(cursorResult);
          }),
        );
        // ? Поскольку на ПГ нет нативного метода для управления метаданными для изменения наименования колонок возвращаемых с БД, подгонять ключи приходится на уровне execute.
        return cursorResults;
      }
      return result;
    });
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
    payload?: U,
  ): IBindingsObjectReturn {
    // Проверка наличия пакета и процедуры в списках
    if (!procedures?.[processName]) {
      throw new Error(
        `Package "${packageName}" or process "${processName}" not found`,
      );
    }

    const functionParams = procedures[processName];

    const processBindings = (payload?: U): IBindingsObjectReturn => {
      const bindings: Array<unknown> = [];
      const cursorsNames: Array<string> = [];
      functionParams.forEach((item, index) => {
        if (item.argument_type === this.refCursorType) {
          cursorsNames.push(item.argument_name);
          bindings.push(item.argument_name);
          return;
        }
        const normalizedName = item.argument_name.replace(/^p_/, '');
        if (typeof payload === 'string' || typeof payload === 'number')
          throw new TypeError(
            'Payload for call procedure must be an object or array or undefined or null',
          );
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
          bindings.push(value.length > 1 ? value.join(',') : value.toString());
          return;
        }
        bindings.push(value);
      });
      const paramInputString = bindings.map((_, i) => `$${i + 1}`).join(',');
      const paramExecuteString = `CALL ${packageName}.${processName}(${paramInputString})`;
      return { paramExecuteString, bindings, cursorsNames };
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

    const sqlString = paramOccurrences.reduce(
      (sql, paramName, index) => sql.replace(`:${paramName}`, `$${index + 1}`),
      sqlQuery,
    );
    return { bindings, sqlString };
  }
}
