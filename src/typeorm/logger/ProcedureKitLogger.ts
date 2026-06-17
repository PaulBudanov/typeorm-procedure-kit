import type {
  ILoggerModule,
  TTypeOrmLoggerLevel,
  TTypeOrmLoggerLevels,
} from '../../types/logger.types.js';
import { safeStringify } from '../../utils/safe-stringify.js';
import type { QueryParameterValues } from '../driver/QueryParameters.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';

import type { Logger } from './Logger.js';

export class ProcedureKitLogger implements Logger {
  private static readonly noopLogger: ILoggerModule = {
    error: (): void => undefined,
    log: (): void => undefined,
    warn: (): void => undefined,
  };

  private readonly enabledLevels: ReadonlySet<TTypeOrmLoggerLevel>;

  public static createNoop(): ProcedureKitLogger {
    return new ProcedureKitLogger(ProcedureKitLogger.noopLogger);
  }

  public constructor(
    private readonly logger: ILoggerModule,
    private readonly levels?: TTypeOrmLoggerLevels
  ) {
    this.enabledLevels = new Set(Array.isArray(levels) ? levels : []);
  }

  public logQuery(
    query: string,
    parameters?: QueryParameterValues,
    _queryRunner?: QueryRunner
  ): void {
    if (!this.isEnabled('query')) return;
    this.logger.log(
      `[TypeORM query]: ${this.formatSql(query)}${this.formatParameters(parameters)}`
    );
  }

  public logQueryError(
    error: string | Error,
    query: string,
    parameters?: QueryParameterValues,
    _queryRunner?: QueryRunner
  ): void {
    if (!this.isEnabled('error')) return;

    const formattedError = this.formatError(error);
    const message = `[TypeORM query failed]: ${this.formatSql(query)}${this.formatParameters(parameters)}; Error: ${formattedError.message}`;

    if (formattedError.stack) {
      this.logger.error(message, formattedError.stack);
    } else {
      this.logger.error(message);
    }
  }

  public logQuerySlow(
    time: number,
    query: string,
    parameters?: QueryParameterValues,
    _queryRunner?: QueryRunner
  ): void {
    if (!this.isEnabled('warn')) return;
    this.logger.warn(
      `[TypeORM slow query (${time}ms)]: ${this.formatSql(query)}${this.formatParameters(parameters)}`
    );
  }

  public logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    if (!this.isEnabled('schema')) return;
    this.logger.log(`TypeORM schema: ${this.normalizeWhitespace(message)}`);
  }

  public logMigration(message: string, _queryRunner?: QueryRunner): void {
    if (!this.isEnabled('migration')) return;
    this.logger.log(`TypeORM migration: ${this.normalizeWhitespace(message)}`);
  }

  public log(
    level: 'log' | 'info' | 'warn',
    message: unknown,
    _queryRunner?: QueryRunner
  ): void {
    if (level === 'warn') {
      if (!this.isEnabled('warn')) return;
      this.logger.warn(`TypeORM warn: ${this.normalizeWhitespace(message)}`);
      return;
    }

    if (!this.isEnabled('info')) return;
    this.logger.log(`TypeORM ${level}: ${this.normalizeWhitespace(message)}`);
  }

  private isEnabled(level: TTypeOrmLoggerLevel): boolean {
    return this.levels === 'all' || this.enabledLevels.has(level);
  }

  private formatSql(sql: string): string {
    return this.normalizeWhitespace(sql);
  }

  private formatParameters(parameters?: QueryParameterValues): string {
    if (
      !parameters ||
      (Array.isArray(parameters)
        ? parameters.length === 0
        : Object.keys(parameters).length === 0)
    )
      return '';
    return `; Bindings: ${safeStringify(parameters)}`;
  }

  private formatError(error: string | Error): {
    message: string;
    stack?: string;
  } {
    if (error instanceof Error) {
      return {
        message: this.normalizeWhitespace(error.message),
        stack: error.stack,
      };
    }

    return { message: this.normalizeWhitespace(error) };
  }

  private normalizeWhitespace(value: unknown): string {
    return String(value).replace(/\s+/g, ' ').trim();
  }
}
