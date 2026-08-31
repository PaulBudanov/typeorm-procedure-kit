import { ServerError } from './server-error.js';

import type { ILoggerModule } from '../types/logger.types.js';
import type { ISqlError } from '../types/utility.types.js';

export abstract class DatabaseErrorHandler {
  private static ERROR_CODE_KEYS = [
    'error_code',
    'err_code',
    'errorCode',
    'errCode',
  ] as const;
  private static ERROR_TEXT_KEYS = [
    'error_text',
    'err_text',
    'errorText',
    'errText',
  ] as const;
  /**
   * Checks if the response data has an error code and throws an error if it does.
   * Useful for catching database errors.
   * Only the top-level response envelope is inspected. Business rows and nested
   * objects are intentionally ignored even if they contain similarly named fields.
   * @param {T | Buffer | string | Array<T>} responseData - response data from the database query.
   * @param {ILoggerModule} [logger] - logger module to log the error message.
   * @throws {DatabaseError} if the response data has an error code.
   */
  public static checkForDatabaseError<T>(
    responseData: T | Buffer | string | Array<T>,
    queryId?: string,
    logger?: ILoggerModule
  ): void {
    if (
      responseData instanceof Buffer ||
      typeof responseData !== 'object' ||
      responseData === null
    ) {
      return;
    }

    if (Array.isArray(responseData)) return;

    const errorData = responseData as ISqlError;
    const errorCodeKey = DatabaseErrorHandler.ERROR_CODE_KEYS.find((key) =>
      Object.hasOwn(errorData, key)
    );
    const errorTextKey = DatabaseErrorHandler.ERROR_TEXT_KEYS.find((key) =>
      Object.hasOwn(errorData, key)
    );
    if (!errorCodeKey || !errorTextKey) return;

    const errorCode = errorData[errorCodeKey];
    const errorText = errorData[errorTextKey];

    const normalizedErrorCode =
      typeof errorCode === 'string' ? errorCode.trim() : errorCode;

    const isFailure =
      typeof normalizedErrorCode === 'number'
        ? normalizedErrorCode !== 0
        : typeof normalizedErrorCode === 'string'
          ? normalizedErrorCode !== '' && !/^0+$/.test(normalizedErrorCode)
          : Boolean(normalizedErrorCode);

    if (!isFailure) return;

    const errorMessage = errorText
      ? `Database error: ${errorText}`
      : `Database error code: ${errorCode?.toString()}`;

    logger?.error(`Detected database error: ${errorMessage}`);

    throw new ServerError(errorMessage, null, {
      errorId: queryId,
    });
  }
}
