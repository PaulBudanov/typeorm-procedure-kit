import type { ILoggerModule } from '../types/logger.types.js';
import type { ISqlError } from '../types/utility.types.js';

import { ServerError } from './server-error.js';

export abstract class DatabaseErrorHandler {
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
    const hasErrorCode =
      Object.hasOwn(errorData, 'error_code') ||
      Object.hasOwn(errorData, 'err_code') ||
      Object.hasOwn(errorData, 'errorCode') ||
      Object.hasOwn(errorData, 'errCode');
    const hasErrorText =
      Object.hasOwn(errorData, 'error_text') ||
      Object.hasOwn(errorData, 'err_text') ||
      Object.hasOwn(errorData, 'errorText') ||
      Object.hasOwn(errorData, 'errText');
    if (!hasErrorCode || !hasErrorText) return;

    const errorCode = Object.hasOwn(errorData, 'error_code')
      ? errorData.error_code
      : Object.hasOwn(errorData, 'err_code')
        ? errorData.err_code
        : Object.hasOwn(errorData, 'errorCode')
          ? errorData.errorCode
          : errorData.errCode;
    const errorText = Object.hasOwn(errorData, 'error_text')
      ? errorData.error_text
      : Object.hasOwn(errorData, 'err_text')
        ? errorData.err_text
        : Object.hasOwn(errorData, 'errorText')
          ? errorData.errorText
          : errorData.errText;

    if (errorCode && errorCode !== 0) {
      const errorMessage = errorText
        ? `Database error: ${errorText}`
        : `Database error code: ${errorCode}`;

      if (logger) {
        logger.error(`Detected database error: ${errorMessage}`);
      }

      throw new ServerError(errorMessage, null, {
        errorId: queryId,
      });
    }
    return;
  }
}
