import { randomUUID } from 'crypto';

import { DateTime } from 'luxon';

export class ServerError extends Error {
  public readonly errorId: string;
  public readonly timestamp: Date = DateTime.now().toLocal().toJSDate();
  public constructor(
    public readonly message: string,
    public readonly errorContext?: unknown,
    public readonly options?: {
      cause?: unknown;
      errorId?: string;
      stack?: string;
    }
  ) {
    super(message, options);
    this.name = 'ServerError';
    this.errorId = options?.errorId ?? randomUUID();
    Object.setPrototypeOf(this, new.target.prototype);
    if (!options?.stack) Error.captureStackTrace?.(this, this.constructor);
  }

  public static ENSURE_SERVER_ERROR(
    error: unknown,
    message?: string
  ): ServerError {
    if (ServerError.isServerError(error)) {
      return error;
    } else if (ServerError.isNodeError(error)) {
      return new ServerError(message ?? error.message, error, {
        cause: error.cause,
        stack: error.stack,
      });
    }
    const messageString =
      error instanceof Error
        ? error.message
        : typeof error === 'object'
          ? JSON.stringify(error)
          : String(error);
    return new ServerError(message ?? messageString, error);
  }

  public unsafeGetContextAs<T>(): T {
    return this.errorContext as T;
  }

  protected static isServerError(error: unknown): error is ServerError {
    return error instanceof ServerError;
  }
  protected static isNodeError(error: unknown): error is Error {
    return error instanceof Error;
  }
}
