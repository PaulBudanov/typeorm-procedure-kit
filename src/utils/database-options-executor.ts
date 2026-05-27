import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { ILoggerModule } from '../types/logger.types.js';

export abstract class DatabaseOptionsExecutor {
  private static readonly SAFE_OPTION_COMMANDS = [
    /^\s*SET\s+LOCAL\s+[A-Za-z_][A-Za-z0-9_.$]*\s*=\s*(?:'[^']*'|[A-Za-z0-9_.$:+-]+)\s*$/i,
    /^\s*SET\s+TRANSACTION\s+(?:ISOLATION\s+LEVEL\s+(?:READ\s+UNCOMMITTED|READ\s+COMMITTED|REPEATABLE\s+READ|SERIALIZABLE)|READ\s+ONLY|READ\s+WRITE|DEFERRABLE|NOT\s+DEFERRABLE)\s*$/i,
    /^\s*ALTER\s+SESSION\s+SET\s+[A-Za-z_][A-Za-z0-9_.$]*\s*=\s*(?:'[^']*'|[A-Za-z0-9_.$:+-]+)\s*$/i,
  ];

  /**
   * Executes an array of SQL commands in the database.
   * @param {Array<string>} commands - an array of SQL commands
   * @param {EntityManager} connection - database connection
   * @param {ILoggerModule} logger - logger module
   * @returns {Promise<void>} - a promise that resolves when all commands are executed successfully
   * @throws {Error} - if an error occurs during the execution of commands
   */
  public static async executeCommands(
    commands: Array<string>,
    connection: EntityManager,
    logger: ILoggerModule
  ): Promise<void> {
    try {
      for (const [index, command] of commands.entries()) {
        this.assertSafeOptionCommand(command);
        logger.log(
          `Execute safe database option command ${index + 1}/${commands.length}`
        );
        await connection.query(command);
      }
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

  private static assertSafeOptionCommand(command: string): void {
    const trimmed = command.trim();
    if (
      trimmed.includes(';') ||
      trimmed.includes('--') ||
      trimmed.includes('/*') ||
      trimmed.includes('*/') ||
      !this.SAFE_OPTION_COMMANDS.some((pattern) => pattern.test(trimmed))
    ) {
      throw new Error(
        'Unsafe database option command. Only single SET LOCAL, SET TRANSACTION, and ALTER SESSION SET commands are allowed.'
      );
    }
  }
}
