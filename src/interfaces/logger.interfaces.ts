export interface ILoggerModule {
  error(message: unknown, stack?: string, context?: string): void;

  log(message: unknown, context?: string): void;

  warn(message: unknown, context?: string): void;
}
