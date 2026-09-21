import { safeStringify } from './safe-stringify.js';
import { ServerError } from './server-error.js';

import type { IErrorEnvelopeKeys } from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';

class DatabaseErrorHandlerApi {
  private static readonly defaultEnvelopeKeys: IErrorEnvelopeKeys = {
    errorCodeKeys: ['error_code', 'err_code', 'errorCode', 'errCode'],
    errorTextKeys: ['error_text', 'err_text', 'errorText', 'errText'],
  };

  /**
   * Checks if the response data has an error code and throws an error if it does.
   * Useful for catching database errors.
   * Only the top-level response envelope is inspected: for an array that is its
   * first element, whatever the array length, and business rows behind it and
   * nested objects are intentionally ignored even if they contain similarly
   * named fields. Only own properties count, so an inherited member never makes
   * a result look like an error envelope.
   * @param {T | Buffer | string | Array<T>} responseData - response data from the database query.
   * @param {string} [queryId] - query id attached to the thrown error.
   * @param {ILoggerModule} [logger] - logger module to log the error message.
   * @param {Partial<IErrorEnvelopeKeys>} [envelopeKeys] - response key names that
   * describe an error envelope. Keys left out keep their built-in defaults.
   * @throws {ServerError} if the response data has an error code.
   */
  public checkForDatabaseError<T>(
    responseData: T | Buffer | string | Array<T>,
    queryId?: string,
    logger?: ILoggerModule,
    envelopeKeys?: Partial<IErrorEnvelopeKeys>
  ): void {
    if (
      responseData instanceof Buffer ||
      typeof responseData !== 'object' ||
      !responseData
    ) {
      return;
    }

    if (Array.isArray(responseData)) {
      const checkDataObject = responseData[0];
      this.checkForDatabaseError<typeof checkDataObject>(
        checkDataObject,
        queryId,
        logger,
        envelopeKeys
      );
      return;
    }

    const errorData = responseData as Record<string, unknown>;
    const { errorCodeKeys, errorTextKeys } =
      this.resolveEnvelopeKeys(envelopeKeys);
    const errorCodeKey = errorCodeKeys.find((key) =>
      Object.hasOwn(errorData, key)
    );
    const errorTextKey = errorTextKeys.find((key) =>
      Object.hasOwn(errorData, key)
    );
    if (errorCodeKey === undefined || errorTextKey === undefined) return;

    const errorCode = errorData[errorCodeKey];
    const errorText = errorData[errorTextKey];

    if (!DatabaseErrorHandlerApi.isFailureCode(errorCode)) return;

    const errorMessage = DatabaseErrorHandlerApi.hasValue(errorText)
      ? `Database error: ${DatabaseErrorHandlerApi.formatEnvelopeValue(errorText)}`
      : `Database error code: ${DatabaseErrorHandlerApi.formatEnvelopeValue(errorCode)}`;

    logger?.error(`Detected database error: ${errorMessage}`);

    throw new ServerError(errorMessage, null, {
      errorId: queryId,
    });
  }

  /** Merges caller-provided key names over the built-in envelope key names. */
  private resolveEnvelopeKeys(
    envelopeKeys: Partial<IErrorEnvelopeKeys> | undefined
  ): IErrorEnvelopeKeys {
    const defaults = DatabaseErrorHandlerApi.defaultEnvelopeKeys;
    return {
      errorCodeKeys: envelopeKeys?.errorCodeKeys ?? defaults.errorCodeKeys,
      errorTextKeys: envelopeKeys?.errorTextKeys ?? defaults.errorTextKeys,
    };
  }

  /** An envelope field carries a message only when it is not empty. */
  private static hasValue(value: unknown): boolean {
    return Boolean(value);
  }

  /** Renders an envelope field for a log line without leaking `[object Object]`. */
  private static formatEnvelopeValue(value: unknown): string {
    return typeof value === 'string' ? value : safeStringify(value);
  }

  /** A zero, blank or absent code marks a successful envelope. */
  private static isFailureCode(errorCode: unknown): boolean {
    const normalizedErrorCode =
      typeof errorCode === 'string' ? errorCode.trim() : errorCode;

    if (typeof normalizedErrorCode === 'number') {
      return normalizedErrorCode !== 0;
    }
    if (typeof normalizedErrorCode === 'string') {
      return normalizedErrorCode !== '' && !/^0+$/.test(normalizedErrorCode);
    }
    return Boolean(normalizedErrorCode);
  }
}

const databaseErrorHandler = new DatabaseErrorHandlerApi();

export { databaseErrorHandler as DatabaseErrorHandler };
