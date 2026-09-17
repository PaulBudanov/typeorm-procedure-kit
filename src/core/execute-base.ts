import { randomUUID } from 'crypto';

import { DatabaseErrorHandler } from '../utils/database-error-handler.js';
import { QueryTimer } from '../utils/query-timer.js';
import { ServerError } from '../utils/server-error.js';

import type { ConnectionBase } from './connection-base.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { IExecutionOptions } from '../types/config.types.js';
import type { ILoggerModule, TBindingLogMode } from '../types/logger.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
  IProcedureResult,
} from '../types/utility.types.js';

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
    private readonly logger: ILoggerModule,
    private readonly bindingLogMode: TBindingLogMode = 'metadata-only'
  ) {}

  /**
   * Executes a SQL query or procedure with the given bindings and options.
   *
   * @param sql - SQL query string
   * @param bindings - bindings for the SQL query or procedure
   * @param cursorsNames - names of the cursors to fetch results from
   * @param executionOptions - execution options such as connection mode, setup commands, and query id
   *
   * @returns a promise that resolves with an array of the results of the query or procedure
   */
  public async execute<T>(
    sql: string,
    bindings: IBindingsObjectReturn['bindings'] = [],
    cursorsNames: Array<string> = [],
    executionOptions: IExecutionOptions = {}
  ): Promise<Awaited<Array<T>>> {
    return this.runWithConnection<Awaited<Array<T>>>(
      sql,
      bindings,
      executionOptions,
      (
        client: EntityManager,
        optionsCommands: Array<string>
      ): Promise<Awaited<Array<T>>> =>
        this.databaseAdapter.execute<T>(
          sql,
          client,
          optionsCommands,
          bindings,
          cursorsNames
        ),
      (result: Awaited<Array<T>>, queryId: string): number | undefined => {
        DatabaseErrorHandler.checkForDatabaseError(result, queryId);
        return ExecuteBase.resolveRowCount(result);
      }
    );
  }

  /**
   * Executes a stored procedure and returns cursor rows together with all
   * scalar and cursor output bindings.
   */
  public async executeProcedure<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    sql: string,
    bindings: IBindingsObjectReturn['bindings'] = [],
    cursorsNames: Array<string> = [],
    outBindings: Array<IProcedureOutBinding> = [],
    executionOptions: IExecutionOptions = {}
  ): Promise<IProcedureResult<TRow, TOut>> {
    return this.runWithConnection<IProcedureResult<TRow, TOut>>(
      sql,
      bindings,
      executionOptions,
      (
        client: EntityManager,
        optionsCommands: Array<string>
      ): Promise<IProcedureResult<TRow, TOut>> =>
        this.databaseAdapter.executeProcedure<TRow, TOut>(
          sql,
          client,
          optionsCommands,
          bindings,
          cursorsNames,
          outBindings
        ),
      (
        result: IProcedureResult<TRow, TOut>,
        queryId: string
      ): number | undefined => {
        DatabaseErrorHandler.checkForDatabaseError(result.rows, queryId);
        DatabaseErrorHandler.checkForDatabaseError(result.outBinds, queryId);
        return ExecuteBase.resolveRowCount(result.rows);
      }
    );
  }

  /**
   * Shared scaffold behind every adapter call: query timing, entity manager
   * lifecycle, error wrapping and the mandatory release of the manager.
   *
   * @param sql - SQL query string, logged by the query timer
   * @param bindings - bindings for the SQL query or procedure, logged by the query timer
   * @param executionOptions - execution options such as connection mode, setup commands, and query id
   * @param runOperation - adapter call to run against the acquired entity manager
   * @param inspectResult - validates the adapter result and returns the row count to log
   */
  private async runWithConnection<TResult>(
    sql: string,
    bindings: IBindingsObjectReturn['bindings'],
    executionOptions: IExecutionOptions,
    runOperation: (
      client: EntityManager,
      optionsCommands: Array<string>
    ) => Promise<TResult>,
    inspectResult: (result: TResult, queryId: string) => number | undefined
  ): Promise<TResult> {
    const {
      mode = 'master',
      optionsCommands = [],
      queryId = randomUUID(),
    } = executionOptions;
    const queryTimer = new QueryTimer(
      sql,
      this.logger,
      queryId,
      bindings,
      this.bindingLogMode
    );
    const client: EntityManager =
      await this.connectionBase.getEntityManager(mode);
    let operationError: ServerError | undefined;
    try {
      const result = await runOperation(client, optionsCommands);
      const rowCount = inspectResult(result, queryId);
      queryTimer.success(rowCount);
      return result;
    } catch (error: unknown) {
      const serverError = ServerError.ENSURE_SERVER_ERROR({
        error,
        errorId: queryId,
      });
      queryTimer.error(serverError);
      operationError = serverError;
      throw serverError;
    } finally {
      await this.releaseEntityManager(client, operationError);
    }
  }

  /**
   * Row count to log for an adapter result. Statements that do not return a
   * rowset (a non-SELECT, for example) have no row count, so nothing is logged
   * instead of a misleading number.
   */
  private static resolveRowCount(result: unknown): number | undefined {
    return Array.isArray(result) ? result.length : undefined;
  }

  /** Preserves both failures when an operation and its mandatory release fail. */
  private async releaseEntityManager(
    client: EntityManager,
    operationError: ServerError | undefined
  ): Promise<void> {
    let capturedReleaseError: unknown;
    let hasReleaseFailed = false;
    try {
      await this.connectionBase.releaseEntityManager(client);
    } catch (releaseError: unknown) {
      if (!operationError) throw releaseError;
      capturedReleaseError = releaseError;
      hasReleaseFailed = true;
    }
    if (hasReleaseFailed) {
      throw new AggregateError(
        [operationError, capturedReleaseError],
        'Database operation and connection release both failed',
        { cause: operationError }
      );
    }
  }
}
