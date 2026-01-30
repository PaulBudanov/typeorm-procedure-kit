import { ServerError } from './server-error.js';

export abstract class AsyncUtils {
  /**
   * Returns a promise that resolves after a specified delay in milliseconds.
   * @param {number} ms - delay time in milliseconds
   * @returns {Promise<void>} - promise that resolves after the specified delay
   * @example
   * const result = await AsyncUtils.delay(1000);
   */
  public static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calls a function with a specified number of retries and a delay between retries
   * if the function throws an error. If the function does not throw an error,
   * it returns the result of the function call. If all retries are exhausted,
   * it throws the last error.
   * @param {() => Promise<T>} fn - function to call
   * @param {number} [maxRetries=3] - maximum number of retries
   * @param {number} [delayMs=1000] - delay in milliseconds between retries
   * @param {logger} [logger] - logger to log warnings and errors
   * @returns {Promise<T>} - result of the function call or the last error if all retries are exhausted
   * @example
   * const result = await AsyncUtils.retry(
   *   () => fetchData(),
   *   5,
   *   1000,
   *   logger
   * );
   */
  public static async retry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delayMs = 1000,
    logger?: { warn: (msg: string) => void; error: (msg: string) => void }
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (logger) {
          logger.warn(
            `Attempt ${attempt} of ${maxRetries} failed: ${lastError.message}`
          );
        }

        if (attempt < maxRetries) {
          await AsyncUtils.delay(delayMs * attempt); // exponential backoff
        }
      }
    }

    if (logger) {
      logger.error(`All ${maxRetries} attempts failed: ${lastError!.message}`);
    }

    throw lastError!;
  }

  /**
   * Returns a promise that resolves or rejects when the first promise in the
   * array resolves or rejects. If the first promise does not resolve or reject
   * before the specified timeout, the returned promise rejects with a timeout error.
   * @param {() => Promise<T>} fn - promise-returning function to timeout
   * @param {number} timeoutMs - timeout in milliseconds
   * @param {string} [timeoutMessage='Operation timeout'] - message for the timeout error
   * @returns {Promise<T>} - promise that resolves or rejects when the first promise resolves or rejects
   * or the timeout error occurs
   */
  public static async timeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage = 'Operation timeout'
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new ServerError(timeoutMessage)), timeoutMs);
    });

    return Promise.race([fn(), timeoutPromise]);
  }
}
