import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type {
  IBindingsObjectReturn,
  TOptionsCommand,
} from '../types/utility.types.js';
import { DatabaseErrorHandler } from '../utils/database-error-handler.js';
import { QueryTimer } from '../utils/query-timer.js';
import { ServerError } from '../utils/server-error.js';

import type { ConnectionBase } from './connection-base.js';

export class ExecuteBase {
  /**
   * Constructor for ExecuteBase
   * @param connectionBase - connection base object to use for executing queries and procedures
   * @param databaseAdapter - database adapter object to use for serializing and deserializing data
   * @param logger - logger module to use for logging
   */
  public constructor(
    private readonly connectionBase: ConnectionBase,
    private readonly databaseAdapter: TAdapterUtilsClassTypes,
    private readonly logger: ILoggerModule
  ) {}

  /**
   * Execute a SQL query or procedure call in a transaction
   * @param {string} sql - SQL query string
   * @param {IBindingsObjectReturn['bindings']} [bindings] - parameters for SQL query
   * @param {TOptionsCommand[keyof TOptionsCommand]} [optionsCommands] - options for database commands
   * @param {Array<string>} [cursorsNames] - names of cursors
   * @returns {Promise<Awaited<Array<T>>>} - result of SQL query call
   * @throws {Error} - if an error occurs during the execution of commands
   */
  public async execute<T>(
    sql: string,
    bindings: IBindingsObjectReturn['bindings'] = [],
    optionsCommands: TOptionsCommand[keyof TOptionsCommand] = [],
    cursorsNames: Array<string> = []
  ): Promise<Awaited<Array<T>>> {
    const queryTimer = new QueryTimer(sql, this.logger);
    const client = await this.connectionBase.getEntityManager();
    try {
      const result: Awaited<Array<T> | T> =
        await this.databaseAdapter.execute<T>(
          sql,
          client,
          optionsCommands,
          bindings,
          cursorsNames
        );
      DatabaseErrorHandler.checkForDatabaseError(result, this.logger);
      queryTimer.success(result.length);
      return result;
    } catch (error: unknown) {
      queryTimer.error(ServerError.ENSURE_SERVER_ERROR(error));
      throw error;
    } finally {
      await this.connectionBase.releaseEntityManager(client);
    }
  }
}
