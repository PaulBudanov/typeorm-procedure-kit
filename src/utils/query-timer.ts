import { DateTime } from 'luxon';

import { QueryLogContextStorage } from './query-log-context.js';
import { safeStringify } from './safe-stringify.js';

import type { ServerError } from './server-error.js';
import type { ILoggerModule, TBindingLogMode } from '../types/logger.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureBindingLogItem,
  ISqlBindingLogItem,
  TQueryLogContext,
} from '../types/utility.types.js';

export class QueryTimer {
  private static readonly sensitiveBindingName =
    /password|passwd|login|pwd|secret|token|authorization|auth|cookie|credential|apikey|api_key|privatekey|private_key/i;

  private startTime: number;
  private readonly logContext?: TQueryLogContext;

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
    private bindings?: IBindingsObjectReturn['bindings'],
    private readonly bindingLogMode: TBindingLogMode = 'metadata-only'
  ) {
    this.logContext = QueryLogContextStorage.getStore();
    this.startTime = DateTime.now().toLocal().toMillis();

    this.logger.log(this.formatStartMessage());
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

    const message = `${this.formatRequestLabel()} completed successfully in ${durationStr}${rowCountInfo}${bindingsInfo}`;

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
    const safeError = this.formatErrorForLog(error);

    const errorMessage = `${this.formatRequestLabel()} failed in ${durationStr}: ${safeError.message}.${bindingsInfo}`;

    this.logger.error(errorMessage, safeError.stack);
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  }

  private truncateSql(sql: string, maxLength: number): string {
    const normalizedSql = this.normalizeWhitespace(sql);
    return normalizedSql.length <= maxLength
      ? normalizedSql
      : `${normalizedSql.substring(0, maxLength)}...`;
  }

  private formatBindingsInfo(): string {
    if (this.logContext?.kind === 'procedure') {
      return this.formatProcedureBindingsInfo(this.logContext.bindings);
    }
    if (this.logContext?.kind === 'sql') {
      return this.formatSqlBindingsInfo(this.logContext.bindings);
    }
    if (!this.hasBindings()) return '';
    if (this.bindingLogMode === 'unsafe-values') {
      return `; Bindings: ${safeStringify(this.bindings)}`;
    }
    if (Array.isArray(this.bindings)) {
      return `; Bindings: [REDACTED: ${this.bindings.length} positional value(s)]`;
    }
    if (this.bindingLogMode === 'metadata-only') {
      return `; Bindings: ${Object.keys(this.bindings ?? {}).length} named value(s) (values hidden)`;
    }
    return `; Bindings: ${Object.entries(this.bindings ?? {})
      .map(
        ([name, value]) =>
          `${name}=${QueryTimer.sensitiveBindingName.test(name) ? '[REDACTED]' : safeStringify(value)}`
      )
      .join(', ')}`;
  }

  private hasBindings(): boolean {
    if (!this.bindings) return false;
    return Array.isArray(this.bindings)
      ? this.bindings.length > 0
      : Object.keys(this.bindings).length > 0;
  }

  private normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private formatStartMessage(): string {
    if (this.logContext?.kind === 'procedure') {
      return `${this.formatRequestLabel()} started${this.formatBindingsInfo()}`;
    }
    return `${this.formatRequestLabel()} started: ${this.truncateSql(this.sql, 100)}`;
  }

  private formatRequestLabel(): string {
    const queryId = this.normalizeWhitespace(this.queryId).slice(0, 128);
    if (this.logContext?.kind === 'procedure') {
      return `Procedure call [${queryId}] ${this.logContext.packageName}.${this.logContext.procedureName}`;
    }
    return `SQL request [${queryId}]`;
  }

  private formatProcedureBindingsInfo(
    bindings: Array<IProcedureBindingLogItem>
  ): string {
    if (!bindings.length) return '';
    return `; Bindings: ${bindings
      .map((binding) => this.formatProcedureBinding(binding))
      .join(', ')}`;
  }

  private formatProcedureBinding(binding: IProcedureBindingLogItem): string {
    const details = [binding.type, binding.mode]
      .filter(Boolean)
      .map((item) => this.normalizeWhitespace(item))
      .join(' ');
    const suffix = details ? ` (${details})` : '';
    return `${binding.name}=${this.formatProcedureBindingValue(binding)}${suffix}`;
  }

  private formatProcedureBindingValue(
    binding: IProcedureBindingLogItem
  ): string {
    if (binding.isCursor) return '<cursor>';
    if (binding.value === undefined && /^OUT$/i.test(binding.mode)) {
      return '<out>';
    }
    if (
      this.bindingLogMode === 'metadata-only' ||
      (this.bindingLogMode === 'redact-by-name' &&
        QueryTimer.sensitiveBindingName.test(binding.name))
    ) {
      return '[REDACTED]';
    }
    return safeStringify(binding.value);
  }

  private formatSqlBindingsInfo(bindings: Array<ISqlBindingLogItem>): string {
    if (!bindings.length) return '';
    return `; Bindings: ${bindings
      .map((binding) => this.formatSqlBinding(binding))
      .join(', ')}`;
  }

  private formatSqlBinding(binding: ISqlBindingLogItem): string {
    return `${binding.name}=${this.formatSqlBindingValue(binding)}`;
  }

  private formatSqlBindingValue(binding: ISqlBindingLogItem): string {
    if (
      this.bindingLogMode === 'metadata-only' ||
      (this.bindingLogMode === 'redact-by-name' &&
        QueryTimer.sensitiveBindingName.test(binding.name))
    ) {
      return '[REDACTED]';
    }
    return safeStringify(binding.value);
  }

  private formatErrorForLog(error: Error): {
    message: string;
    stack?: string;
  } {
    if (this.bindingLogMode === 'unsafe-values' || !this.hasBindings()) {
      return {
        message: this.normalizeWhitespace(error.message),
        stack: error.stack,
      };
    }
    if (
      this.bindingLogMode === 'metadata-only' ||
      (!this.logContext && Array.isArray(this.bindings))
    ) {
      return {
        message: 'Database error details hidden to protect binding values',
      };
    }

    const protectedValues = (
      this.logContext
        ? this.logContext.bindings
            .filter((binding) =>
              QueryTimer.sensitiveBindingName.test(binding.name)
            )
            .map((binding) => binding.value)
        : Object.entries(this.bindings ?? {})
            .filter(([name]) => QueryTimer.sensitiveBindingName.test(name))
            .map(([, value]) => value)
    ).slice(0, 100);
    if (
      protectedValues.some(
        (value) =>
          value !== undefined &&
          value !== null &&
          (typeof value !== 'string' || value.length < 3)
      )
    ) {
      return {
        message: 'Database error details hidden to protect binding values',
      };
    }

    const sanitize = (value: string): string => {
      let sanitized = value;
      for (const protectedValue of protectedValues) {
        if (typeof protectedValue !== 'string' || protectedValue.length === 0) {
          continue;
        }
        sanitized = sanitized.split(protectedValue).join('[REDACTED]');
      }
      return sanitized;
    };
    return {
      message: this.normalizeWhitespace(sanitize(error.message)),
      ...(error.stack === undefined ? {} : { stack: sanitize(error.stack) }),
    };
  }
}
