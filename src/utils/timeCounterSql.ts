import type { ILoggerModule } from '../types.js';

/**
 * Logs the execution time of a given SQL query.
 * @param {number} dateStartMs - start time of the query execution in milliseconds
 * @param {number} dateEndMs - end time of the query execution in milliseconds
 * @param {string} sqlString - SQL query string
 * @param {boolean} isError - whether the query execution was successful or not
 * @param {ILoggerModule} logger - logger instance
 * @param {string} [message] - optional message to log
 */
//TODO: Migrate to class
export function timeCounterSql(
  dateStartMs: number,
  dateEndMs: number,
  sqlString: string,
  isError: boolean,
  logger: ILoggerModule,
  message?: string,
): void {
  const diff = dateEndMs - dateStartMs;
  if (isError) {
    logger.error(
      `SQL ${sqlString} executed not successful, time: ${diff / 1000} seconds \n ${
        message ? ` - ${message}` : ''
      }`,
    );
  } else {
    logger.log(
      `SQL ${sqlString} executed successfully, time: ${diff / 1000} seconds`,
    );
  }
  return;
}
