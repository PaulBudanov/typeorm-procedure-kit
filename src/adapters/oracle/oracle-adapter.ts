import { finished } from 'stream/promises';

import oracledb from 'oracledb';

import type { DataSource } from '../../typeorm/data-source/DataSource.js';
import { replaceNamedParameters } from '../../typeorm/util/NamedParameterUtils.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  INotifyOracleDefaultSettings,
  IOracleOptionsNotify,
} from '../../types/notification.types.js';
import type {
  TProcedureArgumentList,
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';
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
    protected readonly handlerOptions: IRegisteredFetchHandlerOptions,
    protected readonly notifySettings: INotifyOracleDefaultSettings
  ) {
    const oracleConnection = new OracleConnection(appDataSource, logger);
    const oracleNotify = new OracleNotify(
      oracleConnection,
      logger,
      notifySettings
    );
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
      const bindings: Array<oracledb.BindParameter> = [];
      const cursorsNames: Array<string> = [];
      const paramInputArray: Array<string> = [];

      functionParams.forEach((item, index) => {
        SqlIdentifier.validateIdentifier(item.argumentName, 'oracle bind');
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
      const paramExecuteString = `BEGIN ${SqlIdentifier.formatOracleQualifiedIdentifier(
        [packageName, processName]
      )} (${paramInputArray.join(',')}); END;`;
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

  /**
   * Generates a SQL query that loads Oracle package procedure metadata.
   * @param packageName - package name to inspect.
   * @returns SQL query string for procedure metadata loading.
   */
  public override generatePackageInfoSql(packageName: string): string {
    const safePackageName = SqlIdentifier.validateIdentifier(
      packageName,
      'oracle package'
    );
    return (
      OracleSqlCommand.SQL_GET_PACKAGE_INFO +
      `('${safePackageName.toUpperCase()}')`
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
   * Oracle returns REF CURSOR values as ResultSet instances. This method reads
   * each result set as a query stream and concatenates the rows.
   *
   * @param cursorsNames - output cursor names from procedure metadata.
   * @param result - result sets containing cursor rows.
   * @param _manager - unused for Oracle cursor fetching.
   * @returns rows fetched from all cursors.
   */
  protected override async fetchAllCursors<T>(
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
}
