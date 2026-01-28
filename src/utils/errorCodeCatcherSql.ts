import type { ISqlError } from '../types.js';

/**
 * Checks if the response data has an error code and throws an error if it does.
 * Useful for catching database errors.
 * @param {T | Buffer | string} responseData - response data from the database query.
 * @throws {Error} if the response data has an error code.
 */
//TODO: Migrate to utils class
export function errorCodeCatcherSql<T>(
  responseData: T | Buffer | string | Array<T>,
): void {
  if (
    responseData instanceof Buffer ||
    typeof responseData !== 'object' ||
    responseData === null
  ) {
    return;
  }

  if (Array.isArray(responseData)) {
    responseData.forEach((item) => errorCodeCatcherSql(item));
    return;
  }

  const { error_code, err_code, error_text, err_text } =
    responseData as ISqlError;
  if ((error_code && error_code !== 0) || (err_code && err_code !== 0)) {
    throw new Error(
      error_text ??
        err_text ??
        `Database error code: ${error_code ?? err_code}`,
    );
  }
}
