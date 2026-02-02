import { randomUUID } from 'crypto';

import { DateTime } from 'luxon';

import type { ILoggerModule } from '../types/logger.types.js';

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
    private queryId: string = this.generateQueryId()
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
    const duration = Date.now() - this.startTime;
    const durationStr = this.formatDuration(duration);

    const message =
      rowCount !== undefined
        ? `SQL request [${this.queryId}] completed successfully in ${durationStr} with ${rowCount} rows`
        : `SQL request [${this.queryId}] completed successfully in ${durationStr}`;

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
    const duration = Date.now() - this.startTime;
    const durationStr = this.formatDuration(duration);

    this.logger.error(
      `SQL request [${this.queryId}] failed in ${durationStr}: ${error.message}`,
      error.stack
    );
  }

  /**
   * Formats a duration in milliseconds to a string.
   * If the duration is less than 1000ms, it returns the duration in milliseconds.
   * If the duration is greater than or equal to 1000ms and less than 60000ms, it returns the duration in seconds.
   * If the duration is greater than or equal to 60000ms, it returns the duration in minutes.
   * @param {number} ms - duration in milliseconds
   * @returns {string} - formatted duration string
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else {
      return `${(ms / 60000).toFixed(2)}m`;
    }
  }

  /**
   * Truncates a given SQL query string to a given maximum length.
   * If the query string is shorter than the maximum length, it is returned as is.
   * If the query string is longer than the maximum length, it is truncated to the maximum length and '...' is appended to the end.
   * @param {string} sql - SQL query string to truncate
   * @param {number} maxLength - maximum length of the truncated string
   * @returns {string} - truncated SQL query string
   */
  private truncateSql(sql: string, maxLength: number): string {
    if (sql.length <= maxLength) {
      return sql;
    }
    return sql.substring(0, maxLength) + '...';
  }

  /**
   * Generates a unique query ID.
   * @returns {string} - a unique query ID as a UUID.
   */
  private generateQueryId(): string {
    return randomUUID();
  }
}
