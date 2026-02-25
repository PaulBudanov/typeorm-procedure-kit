import { randomUUID } from 'crypto';

import { DateTime } from 'luxon';

export class ServerError extends Error {
  public readonly errorId: string;
  public readonly timestamp: Date = DateTime.now().toLocal().toJSDate();
  /**
   * Constructor for ServerError.
   * @param message - The error message.
   * @param errorContext - An optional object providing additional context about the error.
   * @param options - An optional object with the following properties:
   *   cause - The cause of the error.
   *   errorId - A unique identifier for the error.
   *   stack - The stack trace of the error.
   */
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

  /**
   * Ensures that the given error is a ServerError instance.
   * If the given error is already a ServerError instance, it is returned as is.
   * If the given error is a NodeError instance, it is wrapped in a ServerError instance.
   * If the given error is any other type, it is converted to a string and wrapped in a ServerError instance.
   * @param error - The error to ensure is a ServerError instance.
   * @param message - An optional string to use as the error message.
   * @returns A ServerError instance.
   */
  public static ENSURE_SERVER_ERROR(errorObject: {
    error: unknown;
    message?: string;
    errorId?: string;
  }): ServerError {
    if (ServerError.isServerError(errorObject.error)) {
      return errorObject.error;
    } else if (ServerError.isNodeError(errorObject.error)) {
      return new ServerError(
        errorObject.message ?? errorObject.error.message,
        errorObject.error,
        {
          cause: errorObject.error.cause,
          stack: errorObject.error.stack,
          errorId: errorObject.errorId,
        }
      );
    }
    const messageString =
      errorObject.error instanceof Error
        ? errorObject.error.message
        : typeof errorObject.error === 'object'
          ? JSON.stringify(errorObject.error)
          : String(errorObject.error);
    return new ServerError(
      errorObject.message ?? messageString,
      errorObject.error,
      { errorId: errorObject.errorId }
    );
  }

  /**
   * Retrieves the error context as the given type. This method does not perform any type checks,
   * so it is up to the caller to ensure that the type is correct.
   * @template T The type of the error context.
   * @returns The error context as the given type.
   */
  public unsafeGetContextAs<T>(): T {
    return this.errorContext as T;
  }

  /**
   * Checks if the given value is an instance of ServerError.
   * @param error The value to check.
   * @returns True if the value is an instance of ServerError, false otherwise.
   */
  protected static isServerError(error: unknown): error is ServerError {
    return error instanceof ServerError;
  }
  /**
   * Checks if the given value is an instance of the built-in Node.js Error class.
   * @param error The value to check.
   * @returns True if the value is an instance of the built-in Node.js Error class, false otherwise.
   */
  protected static isNodeError(error: unknown): error is Error {
    return error instanceof Error;
  }
}
