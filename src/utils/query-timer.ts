import { DateTime } from 'luxon';

import type { ILoggerModule } from '../types/logger.types.js';
import type { IBindingsObjectReturn } from '../types/utility.types.js';

import { ServerError } from './server-error.js';

export class QueryTimer {
  private startTime: number;

  /**
   * Constructor for QueryTimer class.
   * Initializes the QueryTimer object with the provided SQL query, logger and query ID.
   * The constructor logs the start of the SQL query execution with the query ID and the first 100 characters of the SQL query.
   * @param {string} sql - SQL query string
   * @param {ILoggerModule} logger - logger module to log messages
   * @param {string} [queryId] - optional query ID, defaults to a generated query ID
   */
  public constructor(
    private sql: string,
    private logger: ILoggerModule,
    private queryId: string,
    private bindings?: IBindingsObjectReturn['bindings']
  ) {
    this.startTime = DateTime.now().toLocal().toMillis();

    this.logger.log(
      `SQL request [${this.queryId}] started: ${this.truncateSql(this.sql, 100)}`
    );
  }

  /**
   * Logs the successful execution of a SQL query.
   * The method will log the duration of the query execution and the number of rows returned.
   * If the duration is greater than 5000ms, the method will log a warning.
   * If the duration is greater than 1000ms, the method will log a message.
   * If the duration is less than 1000ms, the method will log a debug message.
   * @param {number} [rowCount] - number of rows returned by the query
   */
  public success(rowCount?: number): void {
    const duration = DateTime.now().toMillis() - this.startTime;
    const durationStr = this.formatDuration(duration);

    const rowCountInfo = rowCount != null ? ` with ${rowCount} rows` : '';
    const bindingsInfo = this.formatBindingsInfo();

    const message = `SQL request [${this.queryId}] completed successfully in ${durationStr}${rowCountInfo}${bindingsInfo}`;

    if (duration > 5000) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }

  /**
   * Logs an error of a SQL query.
   * The method will log the duration of the query execution and the error message.
   * @param error - error to log
   */
  public error(error: ServerError | Error): void {
    const duration = DateTime.now().toMillis() - this.startTime;
    const durationStr = this.formatDuration(duration);

    const bindingsInfo = this.formatBindingsInfo();

    const errorMessage = `SQL request [${this.queryId}] failed in ${durationStr}: ${error.message}.${bindingsInfo}`;

    this.logger.error(errorMessage, error.stack);
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  }

  private truncateSql(sql: string, maxLength: number): string {
    return sql.length <= maxLength ? sql : `${sql.substring(0, maxLength)}...`;
  }

  private formatBindingsInfo(): string {
    if (!this.bindings?.length) return '';
    return `\nBindings: ${this.bindings.length} value(s), redacted`;
  }
}
