import { safeStringify } from '../../utils/safe-stringify.js';

import type { Logger } from './Logger.js';
import type {
  ILoggerModule,
  TBindingLogMode,
  TTypeOrmLoggerLevel,
  TTypeOrmLoggerLevels,
} from '../../types/logger.types.js';
import type { QueryParameterValues } from '../driver/QueryParameters.js';
import type { QueryRunner } from '../query-runner/QueryRunner.js';

export class ProcedureKitLogger implements Logger {
  private static readonly hiddenDriverErrorMessage =
    'Database query failed; driver details hidden because binding values could not be safely redacted.';
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
    private readonly levels?: TTypeOrmLoggerLevels,
    private readonly bindingLogMode: TBindingLogMode = 'metadata-only'
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

    const formattedError = this.formatError(error, parameters);
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
    if (this.bindingLogMode === 'unsafe-values') {
      return `; Bindings: ${safeStringify(parameters)}`;
    }

    if (this.bindingLogMode === 'metadata-only') {
      return '; Bindings: [values hidden]';
    }

    if (Array.isArray(parameters)) {
      return (
        `; Bindings: ${parameters.length} positional value(s) ` +
        `(types: ${parameters.map((value) => this.bindingType(value)).join(', ')}; values hidden)`
      );
    }

    return `; Bindings: ${Object.entries(parameters)
      .map(
        ([name, value]) =>
          `${name}=${this.isSensitiveBindingName(name) ? '[REDACTED]' : safeStringify(value)}`
      )
      .join(', ')}`;
  }

  private formatError(
    error: string | Error,
    parameters?: QueryParameterValues
  ): {
    message: string;
    stack?: string;
  } {
    if (!this.canSafelyRedactError(parameters)) {
      return { message: ProcedureKitLogger.hiddenDriverErrorMessage };
    }

    if (error instanceof Error) {
      return {
        message: this.sanitizeErrorText(error.message, parameters),
        stack: error.stack
          ? this.sanitizeErrorText(error.stack, parameters, false)
          : undefined,
      };
    }

    return { message: this.sanitizeErrorText(error, parameters) };
  }

  private bindingType(value: unknown): string {
    if (value === null) return 'null';
    if (value instanceof Date) return 'date';
    if (value instanceof Uint8Array) return 'binary';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  private isSensitiveBindingName(name: string): boolean {
    return /(?:password|passwd|pwd|secret|token|api[-_]?key|authorization|credential)/i.test(
      name
    );
  }

  private sanitizeErrorText(
    value: unknown,
    parameters?: QueryParameterValues,
    normalizeWhitespace = true
  ): string {
    let text = normalizeWhitespace
      ? this.normalizeWhitespace(value)
      : String(value);
    if (this.bindingLogMode === 'unsafe-values' || !parameters) return text;

    const values = (
      Array.isArray(parameters)
        ? parameters
        : Object.entries(parameters)
            .filter(([name]) =>
              this.bindingLogMode === 'metadata-only'
                ? true
                : this.isSensitiveBindingName(name)
            )
            .map(([, parameter]) => parameter)
    ).filter(
      (parameter): parameter is string =>
        typeof parameter === 'string' && parameter.length >= 3
    );
    for (const parameter of [...new Set(values)].slice(0, 100)) {
      text = text.split(parameter).join('[REDACTED]');
    }
    return text;
  }

  private canSafelyRedactError(parameters?: QueryParameterValues): boolean {
    if (this.bindingLogMode === 'unsafe-values' || !parameters) return true;

    const protectedValues = Array.isArray(parameters)
      ? parameters
      : Object.entries(parameters)
          .filter(([name]) =>
            this.bindingLogMode === 'metadata-only'
              ? true
              : this.isSensitiveBindingName(name)
          )
          .map(([, value]) => value);
    if (
      protectedValues.some(
        (value) => typeof value !== 'string' || value.length < 3
      )
    ) {
      return false;
    }

    return new Set(protectedValues).size <= 100;
  }

  private normalizeWhitespace(value: unknown): string {
    return String(value).replace(/\s+/g, ' ').trim();
  }
}
