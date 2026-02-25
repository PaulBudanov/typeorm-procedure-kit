import { randomUUID } from 'crypto';

import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type { IBindingsObjectReturn } from '../types/utility.types.js';
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
   * Executes a SQL query or procedure with the given bindings and options.
   *
   * @param sql - SQL query string
   * @param bindings - bindings for the SQL query or procedure
   * @param optionsCommands - options commands to be executed before the query (e.g. SET ROLE, SET SCHEMA)
   * @param cursorsNames - names of the cursors to fetch results from
   * @param queryId - ID of the query to log (optional)
   *
   * @returns a promise that resolves with an array of the results of the query or procedure
   */
  public async execute<T>(
    sql: string,
    bindings: IBindingsObjectReturn['bindings'] = [],
    optionsCommands: Array<string> = [],
    cursorsNames: Array<string> = [],
    queryId: string = randomUUID()
  ): Promise<Awaited<Array<T>>> {
    const queryTimer = new QueryTimer(sql, this.logger, queryId, bindings);
    const client: EntityManager = await this.connectionBase.getEntityManager();
    try {
      const result: Awaited<Array<T> | T> =
        await this.databaseAdapter.execute<T>(
          sql,
          client,
          optionsCommands,
          bindings,
          cursorsNames
        );
      DatabaseErrorHandler.checkForDatabaseError(result, queryId, this.logger);
      queryTimer.success(result.length);
      return result;
    } catch (error: unknown) {
      const serverError = ServerError.ENSURE_SERVER_ERROR({
        error,
        errorId: queryId,
      });
      queryTimer.error(serverError);
      throw serverError;
    } finally {
      await this.connectionBase.releaseEntityManager(client);
    }
  }
}
