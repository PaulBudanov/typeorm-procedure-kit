import { ServerError } from './server-error.js';

import type { ILoggerModule } from '../types/logger.types.js';
import type { ISqlError } from '../types/utility.types.js';

class DatabaseErrorHandlerApi {
  private readonly errorCodeKeys = [
    'error_code',
    'err_code',
    'errorCode',
    'errCode',
  ] as const;
  private readonly errorTextKeys = [
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
  public checkForDatabaseError<T>(
    responseData: T | Buffer | string | Array<T>,
    queryId?: string,
    logger?: ILoggerModule
  ): void {
    if (
      responseData instanceof Buffer ||
      typeof responseData !== 'object' ||
      !responseData
    ) {
      return;
    }

    if (Array.isArray(responseData)) {
      if (responseData.length > 1) return;
      const checkDataObject = responseData[0];
      this.checkForDatabaseError<typeof checkDataObject>(checkDataObject);
      return;
    }

    const errorData = responseData as ISqlError;
    const errorCodeKey = this.errorCodeKeys.find((key) => key in errorData);
    const errorTextKey = this.errorTextKeys.find((key) => key in errorData);
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

const databaseErrorHandler = new DatabaseErrorHandlerApi();

export { databaseErrorHandler as DatabaseErrorHandler };
