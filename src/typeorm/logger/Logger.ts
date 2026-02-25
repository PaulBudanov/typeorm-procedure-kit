import type { QueryRunner } from '../query-runner/QueryRunner.js';

/**
 * Performs logging of the events in TypeORM.
 */
export interface Logger {
  /**
   * Logs query and parameters used in it.
   */
  logQuery(
    query: string,
    parameters?: Array<unknown>,
    queryRunner?: QueryRunner
  ): void;

  /**
   * Logs query that is failed.
   */
  logQueryError(
    error: string | Error,
    query: string,
    parameters?: Array<unknown>,
    queryRunner?: QueryRunner
  ): void;

  /**
   * Logs query that is slow.
   */
  logQuerySlow(
    time: number,
    query: string,
    parameters?: Array<unknown>,
    queryRunner?: QueryRunner
  ): void;

  /**
   * Logs events from the schema build process.
   */
  logSchemaBuild(message: string, queryRunner?: QueryRunner): void;

  /**
   * Logs events from the migrations run process.
   */
  logMigration(message: string, queryRunner?: QueryRunner): void;

  /**
   * Perform logging using given logger, or by default to the console.
   * Log has its own level and message.
   */
  log(
    level: 'log' | 'info' | 'warn',
    message: unknown,
    queryRunner?: QueryRunner
  ): void;
}

/**
 * Log level.
 */
export type LogLevel =
  | 'query'
  | 'schema'
  | 'error'
  | 'warn'
  | 'info'
  | 'log'
  | 'migration';

/**
 * Log message.
 */
export interface LogMessage {
  type?: LogMessageType;
  prefix?: string;
  message: string | number;
  format?: LogMessageFormat;
  parameters?: Array<unknown>;
  additionalInfo?: Record<string, unknown>;
}

/**
 * Log message format.
 */
export type LogMessageFormat = 'sql';

/**
 * Log message type.
 */
export type LogMessageType =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'query'
  | 'query-error'
  | 'query-slow'
  | 'schema-build'
  | 'migration';

/**
 * Options for prepare log messages
 */
export interface PrepareLogMessagesOptions {
  highlightSql: boolean;
  formatSql: boolean;
  appendParameterAsComment: boolean;
  addColonToPrefix: boolean;
}
