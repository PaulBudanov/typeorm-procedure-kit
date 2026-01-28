import type { IBindingsObjectReturn, TOptionsCommand } from '../types.js';
import { errorCodeCatcherSql } from '../utils/errorCodeCatcherSql.js';
// import { lowerCaseTransform } from '../utils/lower-case-transform.js';
import { timeCounterSql } from '../utils/timeCounterSql.js';

import { ConnectionBase } from './connection-base.js';

export class ExecuteBase extends ConnectionBase {
  /**
   * Executes a SQL query.
   * If the database is Postgres, the function will use the Postgres driver.
   * If the database is Oracle, the function will use the Oracle driver.
   * If the database is configured to transform response keys to camelCase,
   * the function will transform the response keys to lowercase(deprecated) or camelCase.
   * If an error occurs during the execution, the function will log the error and
   * throw the error.
   * @param sql - SQL query string
   * @param bindings - parameters for SQL query
   * @param optionsCommands - options for database commands
   * @param cursorsNames - names of cursors
   * @returns result of SQL query call
   */
  protected async execute<T>(
    sql: string,
    bindings: IBindingsObjectReturn['bindings'] = [],
    optionsCommands: TOptionsCommand = {
      postgres: [],
      oracle: [],
    },
    cursorsNames: Array<string> = [],
  ): Promise<Array<T>> {
    // console.log('test');
    const timeStartMs = new Date().getTime();
    const client = await this.getConnectionFromPool();
    try {
      const result: Awaited<Array<T> | T> =
        await this.dbUtilsInstance.execute<T>(
          sql,
          client,
          this.dbConfig.type === 'postgres'
            ? optionsCommands.postgres
            : optionsCommands.oracle,
          bindings,
          cursorsNames,
        );
      timeCounterSql(
        timeStartMs,
        new Date().getTime(),
        sql,
        false,
        this.logger,
      );
      // errorCodeCatcherSql(result);
      // if (this.dbConfig.isNeedRegisterParamKeyTransform) {
      errorCodeCatcherSql(result);
      return result;
      // }
      // return lowerCaseTransform.responseKeysToLower<T>(result) as Array<T>;
    } catch (error: unknown) {
      this.logger.error(`Failed to execute sql: ${(error as Error).message}`);
      timeCounterSql(
        timeStartMs,
        new Date().getTime(),
        sql,
        true,
        this.logger,
        (error as Error).message,
      );
      throw error;
    } finally {
      await this.releaseConnection(client);
    }
  }

  // protected executeWithCamelCase<T>(
  //   sql: string,
  //   bindings: IBindingsObjectReturn['bindings'] = [],
  //   optionsCommands: TOptionsCommand = {
  //     postgres: [],
  //     oracle: [],
  //   },
  //   cursorsNames: Array<string> = [],
  // ): Promise<Array<T>> {
  //   return this.execute<T>(sql, bindings, optionsCommands, cursorsNames);
  // }
}
