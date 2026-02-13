import type { ILoggerModule } from '../types/logger.types.js';
import type { ISqlError } from '../types/utility.types.js';

import { ServerError } from './server-error.js';

export abstract class DatabaseErrorHandler {
  /**
   * Checks if the response data has an error code and throws an error if it does.
   * Useful for catching database errors.
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

    if (Array.isArray(responseData)) {
      responseData.forEach((item) =>
        DatabaseErrorHandler.checkForDatabaseError(item, queryId, logger)
      );
      return;
    }

    const errorData = responseData as ISqlError;
    const errorCode = errorData.error_code ?? errorData.err_code;
    const errorText = errorData.error_text ?? errorData.err_text;

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
