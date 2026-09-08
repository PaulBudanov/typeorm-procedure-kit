import { ServerError } from './server-error.js';

import type { IValidatedOptionCommand } from '../interfaces/database-options-executor.interfaces.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { ILoggerModule } from '../types/logger.types.js';

const POSTGRES_IDENTIFIER = String.raw`(?:[A-Za-z_][A-Za-z0-9_$]*|"[A-Za-z_$][A-Za-z0-9_$]*")`;
const SQL_STRING_LITERAL = String.raw`'(?:[^']|'')*'`;
const INVALIDATE_CONNECTION = Symbol.for(
  'typeorm-procedure-kit.invalidate-connection'
);

class DatabaseOptionsExecutorApi {
  private readonly safePostgresCommands = [
    new RegExp(String.raw`^SET\s+LOCAL\s+ROLE\s+${POSTGRES_IDENTIFIER}$`, 'i'),
    new RegExp(
      String.raw`^SET\s+LOCAL\s+search_path\s+(?:TO|=)\s+${POSTGRES_IDENTIFIER}(?:\s*,\s*${POSTGRES_IDENTIFIER})*$`,
      'i'
    ),
    new RegExp(
      String.raw`^SET\s+LOCAL\s+TIME\s+ZONE\s+(?:UTC|${SQL_STRING_LITERAL})$`,
      'i'
    ),
    new RegExp(
      String.raw`^SET\s+LOCAL\s+app\.[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:${SQL_STRING_LITERAL}|[A-Za-z0-9_.$:+-]+)$`,
      'i'
    ),
    /^SET\s+TRANSACTION\s+(?:ISOLATION\s+LEVEL\s+(?:READ\s+UNCOMMITTED|READ\s+COMMITTED|REPEATABLE\s+READ|SERIALIZABLE)|READ\s+ONLY|READ\s+WRITE|DEFERRABLE|NOT\s+DEFERRABLE)$/i,
  ];
  private readonly safeOracleCommand = new RegExp(
    String.raw`^ALTER\s+SESSION\s+SET\s+(NLS_DATE_FORMAT|NLS_TIMESTAMP_FORMAT|NLS_TIMESTAMP_TZ_FORMAT|NLS_NUMERIC_CHARACTERS)\s*=\s*(${SQL_STRING_LITERAL})$`,
    'i'
  );

  /**
   * Executes an array of SQL commands in the database.
   * @param {Array<string>} commands - an array of SQL commands
   * @param {EntityManager} connection - database connection
   * @param {ILoggerModule} logger - logger module
   * @returns {Promise<void>} - a promise that resolves when all commands are executed successfully
   * @throws {Error} - if an error occurs during the execution of commands
   */
  public async executeCommands(
    commands: Array<string>,
    connection: EntityManager,
    logger: ILoggerModule
  ): Promise<void> {
    try {
      const validatedCommands = this.validateCommands(commands);
      if (validatedCommands[0]?.dialect === 'oracle') {
        throw new ServerError(
          'Oracle session commands require executeWithCommands() so their previous values can be restored'
        );
      }
      await this.executeValidatedCommands(
        validatedCommands,
        connection,
        logger
      );
      logger.log('All commands executed successfully');
      return;
    } catch (error) {
      logger.error(
        `Ошибка выполнения команд базы данных: ${(error as Error).message}`,
        (error as Error).stack
      );
      throw error;
    }
  }

  /**
   * Executes setup commands around one transactional operation. PostgreSQL
   * commands are transaction-local. Oracle session values are captured before
   * mutation and restored even when setup or the operation fails.
   */
  public async executeWithCommands<T>(
    commands: Array<string>,
    connection: EntityManager,
    logger: ILoggerModule,
    operation: () => Promise<T>
  ): Promise<T> {
    if (commands.length === 0) return operation();
    const validatedCommands = this.validateCommands(commands);
    if (validatedCommands[0]?.dialect === 'postgres') {
      await this.executeValidatedCommands(
        validatedCommands,
        connection,
        logger
      );
      return operation();
    }
    return this.executeWithRestoredOracleSession(
      validatedCommands,
      connection,
      logger,
      operation
    );
  }

  private validateCommands(
    commands: Array<string>
  ): Array<IValidatedOptionCommand> {
    const validated = commands.map((command) => this.validateCommand(command));
    const dialect = validated[0]?.dialect;
    if (validated.some((command) => command.dialect !== dialect)) {
      throw new ServerError(
        'Database option commands for different dialects cannot be mixed'
      );
    }
    return validated;
  }

  private validateCommand(command: string): IValidatedOptionCommand {
    const trimmed = command.trim();
    if (
      trimmed.length === 0 ||
      trimmed.includes(';') ||
      trimmed.includes('--') ||
      trimmed.includes('/*') ||
      trimmed.includes('*/')
    ) {
      return this.throwUnsafeCommand();
    }
    if (this.safePostgresCommands.some((pattern) => pattern.test(trimmed))) {
      return { command: trimmed, dialect: 'postgres' };
    }
    const oracleMatch = this.safeOracleCommand.exec(trimmed);
    if (oracleMatch) {
      const value = oracleMatch[2];
      if (!value || value.length > 258) return this.throwUnsafeCommand();
      return {
        command: trimmed,
        dialect: 'oracle',
        oracleParameter: oracleMatch[1]?.toUpperCase(),
      };
    }
    return this.throwUnsafeCommand();
  }

  private throwUnsafeCommand(): never {
    throw new ServerError(
      'Unsafe database option command. Only transaction-local PostgreSQL options and explicitly supported Oracle NLS formats are accepted.'
    );
  }

  private async executeValidatedCommands(
    commands: Array<IValidatedOptionCommand>,
    connection: EntityManager,
    logger: ILoggerModule
  ): Promise<void> {
    for (const [index, command] of commands.entries()) {
      logger.log(
        `Execute safe database option command ${index + 1}/${commands.length}`
      );
      await connection.query(command.command);
    }
  }

  private async executeWithRestoredOracleSession<T>(
    commands: Array<IValidatedOptionCommand>,
    connection: EntityManager,
    logger: ILoggerModule,
    operation: () => Promise<T>
  ): Promise<T> {
    const originalValues = new Map<string, string>();
    for (const command of commands) {
      const parameter = command.oracleParameter;
      if (!parameter || originalValues.has(parameter)) continue;
      const rows = await connection.query<Array<Record<string, unknown>>>(
        'SELECT value FROM nls_session_parameters WHERE parameter = :1',
        [parameter]
      );
      const value = rows[0]?.value ?? rows[0]?.VALUE;
      if (typeof value !== 'string') {
        throw new ServerError(
          `Unable to capture Oracle session value for ${parameter}`
        );
      }
      originalValues.set(parameter, value);
    }

    let result: T | undefined;
    let primaryError: unknown;
    try {
      await this.executeValidatedCommands(commands, connection, logger);
      result = await operation();
    } catch (error: unknown) {
      primaryError = error;
    }

    let restoreError: unknown;
    try {
      for (const [parameter, value] of [...originalValues].reverse()) {
        const escapedValue = value.replaceAll("'", "''");
        await connection.query(
          `ALTER SESSION SET ${parameter} = '${escapedValue}'`
        );
      }
      logger.log('Oracle session options restored');
    } catch (error: unknown) {
      restoreError = error;
    }

    if (primaryError !== undefined && restoreError !== undefined) {
      throw this.markConnectionForInvalidation(
        new AggregateError(
          [primaryError, restoreError],
          'Database operation failed and Oracle session restoration also failed',
          { cause: primaryError }
        )
      );
    }
    if (restoreError !== undefined) {
      throw this.markConnectionForInvalidation(
        ServerError.ENSURE_SERVER_ERROR({
          error: restoreError,
          message: 'Failed to restore Oracle session options',
        })
      );
    }
    if (primaryError !== undefined) {
      throw primaryError instanceof Error
        ? primaryError
        : ServerError.ENSURE_SERVER_ERROR({ error: primaryError });
    }
    return result as T;
  }

  private markConnectionForInvalidation<T extends Error>(error: T): T {
    Object.defineProperty(error, INVALIDATE_CONNECTION, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return error;
  }
}

const databaseOptionsExecutor = new DatabaseOptionsExecutorApi();

export { databaseOptionsExecutor as DatabaseOptionsExecutor };
