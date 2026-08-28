export interface ILoggerModule {
  error(message: unknown, stack?: string, context?: string): void;

  log(message: unknown, context?: string): void;

  warn(message: unknown, context?: string): void;
}

export type TTypeOrmLoggerLevel =
  | 'query'
  | 'error'
  | 'schema'
  | 'info'
  | 'warn'
  | 'migration';

export type TTypeOrmLoggerLevels = 'all' | ReadonlyArray<TTypeOrmLoggerLevel>;

/** Controls how database binding values are written to application logs. */
export type TBindingLogMode =
  | 'redact-by-name'
  | 'metadata-only'
  | 'unsafe-values';
