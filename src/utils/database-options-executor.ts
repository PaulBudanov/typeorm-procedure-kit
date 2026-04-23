import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { ILoggerModule } from '../types/logger.types.js';

export abstract class DatabaseOptionsExecutor {
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
        logger.log(
          `Execute command ${index + 1}/${commands.length}: ${this.truncateCommand(command)}`
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

  /**
   * Truncates a given SQL command string to a given maximum length.
   * If the command string is shorter than the maximum length, it is returned as is.
   * If the command string is longer than the maximum length, it is truncated to the maximum length and '...' is appended to the end.
   * @param {string} command - SQL command string to truncate
   * @param {number} [maxLength] - maximum length of the truncated string
   * @returns {string} - truncated SQL command string
   */
  private static truncateCommand(command: string, maxLength = 50): string {
    if (command.length <= maxLength) {
      return command;
    }
    return command.substring(0, maxLength) + '...';
  }
}
