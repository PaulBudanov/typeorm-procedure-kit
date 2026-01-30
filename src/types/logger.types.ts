export interface ILoggerModule {
  error(message: unknown, stack?: string, context?: string): void;
  error(message: unknown, ...optionalParams: [...[], string?, string?]): void;

  log(message: unknown, context?: string): void;
  log(message: unknown, ...optionalParams: [...[], string?]): void;

  warn(message: unknown, context?: string): void;
  warn(message: unknown, ...optionalParams: [...[], string?]): void;

  debug(message: unknown, context?: string): void;
  debug(message: unknown, ...optionalParams: [...[], string?]): void;

  verbose(message: unknown, context?: string): void;
  verbose(message: unknown, ...optionalParams: [...[], string?]): void;
}
