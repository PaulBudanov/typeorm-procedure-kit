import { DateTime } from 'luxon';

import { ServerError } from './server-error.js';

export abstract class DateFormatter {
  private static readonly DEFAULT_DATE_FORMAT = 'yyyy-MM-dd';
  private static readonly DEFAULT_DATETIME_TZ_FORMAT = 'yyyy-MM-dd HH:mm:ss Z';
  private static readonly DEFAULT_TIME_FORMAT = 'HH:mm:ss';

  /**
   * Formats a date string in the format specified by outputFormat.
   * If setLocalZone is true, the date will be converted to the local timezone.
   * If input is a string, it will be parsed as a SQL date string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param input - Date string or Date object to be formatted.
   * @param outputFormat - Format string for the output date.
   * @param setLocalZone - Flag indicating whether to convert the date to the local timezone.
   **/
  public static formatSqlDate(
    input: string | Date,
    outputFormat: string = this.DEFAULT_DATE_FORMAT,
    setLocalZone = true
  ): string {
    try {
      const dateTime =
        typeof input === 'string'
          ? DateTime.fromSQL(input, { setZone: setLocalZone })
          : DateTime.fromJSDate(input, {
              zone: setLocalZone ? 'local' : undefined,
            });

      if (!dateTime.isValid) {
        throw new ServerError(`Invalid date: ${dateTime.invalidReason}`);
      }

      return dateTime.toFormat(outputFormat);
    } catch (error) {
      throw new ServerError(
        `Error formatting date: ${(error as Error).message}`
      );
    }
  }

  /**
   * Parses a SQL date string into a Luxon DateTime object.
   * If setLocalZone is true, the date will be converted to the local timezone.
   * If the input string is invalid, an error will be thrown.
   * @param input - SQL date string to be parsed.
   * @param setLocalZone - Flag indicating whether to convert the date to the local timezone.
   * @returns a Luxon DateTime object.
   * @throws Error - if the input string is invalid.
   */
  public static parseSqlDate(input: string, setLocalZone = true): DateTime {
    const dateTime = DateTime.fromSQL(input, { setZone: setLocalZone });

    if (!dateTime.isValid) {
      throw new ServerError(`Invalid date: ${dateTime.invalidReason}`);
    }

    return dateTime;
  }

  /**
   * Formats a date string in the default date format (yyyy-MM-dd).
   * If input is a string, it will be parsed as a SQL date string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param input - Date string or Date object to be formatted.
   * @returns a formatted date string.
   */
  public static formatDefaultDate(input: string | Date): string {
    return this.formatSqlDate(input, this.DEFAULT_DATE_FORMAT);
  }

  /**
   * Formats a date string in the default datetime format (yyyy-MM-dd HH:mm:ss).
   * If input is a string, it will be parsed as a SQL date string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param input - Date string or Date object to be formatted.
   * @returns a formatted datetime string.
   */
  public static formatDefaultDateTime(input: string | Date): string {
    return this.formatSqlDate(input, this.DEFAULT_DATETIME_TZ_FORMAT);
  }

  /**
   * Formats a date string in the default datetime with timezone format (yyyy-MM-dd HH:mm:ss Z).
   * If input is a string, it will be parsed as a SQL date string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param input - Date string or Date object to be formatted.
   * @returns a formatted datetime string with timezone.
   */
  public static formatDefaultDateTimeWithTimezone(
    input: string | Date
  ): string {
    return this.formatSqlDate(input, this.DEFAULT_DATETIME_TZ_FORMAT);
  }

  /**
   * Formats a time string in the default time format (HH:mm:ss).
   * If input is a string, it will be parsed as a SQL time string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param input - Time string or Date object to be formatted.
   * @returns a formatted time string.
   */
  public static formatTime(input: string | Date): string {
    return this.formatSqlDate(input, this.DEFAULT_TIME_FORMAT);
  }

  /**
   * Converts a date string or a Date object from one timezone to another.
   * If input is a string, it will be parsed as a SQL date string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param input - Date string or Date object to be converted.
   * @param timeZone - The timezone to convert to.
   * @param format - The format of the output datetime string. Defaults to 'yyyy-MM-dd HH:mm:ss ZZ'.
   * @returns a formatted datetime string in the specified timezone.
   * @throws Error - If the input date string is invalid.
   */
  public static convertTimeZone(
    input: string | Date,
    timeZone: string,
    format: string = this.DEFAULT_DATETIME_TZ_FORMAT
  ): string {
    try {
      const dateTime =
        typeof input === 'string'
          ? DateTime.fromSQL(input, { setZone: true })
          : DateTime.fromJSDate(input, {
              zone: 'local',
            });

      if (!dateTime.isValid) {
        throw new ServerError(`Invalid date: ${dateTime.invalidReason}`);
      }

      return dateTime.setZone(timeZone).toFormat(format);
    } catch (error) {
      throw new ServerError(
        `Error converting date: ${(error as Error).message}`,
        error
      );
    }
  }

  /**
   * Calculates the absolute difference between two dates in the specified unit.
   * If input is a string, it will be parsed as a SQL date string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param date1 - First date to compare.
   * @param date2 - Second date to compare.
   * @param unit - The unit of time to calculate the difference in. Defaults to 'days'.
   * @returns The absolute difference between the two dates in the specified unit.
   */
  public static diff(
    date1: string | Date,
    date2: string | Date,
    unit: 'days' | 'hours' | 'minutes' | 'seconds' = 'days'
  ): number {
    const dt1 =
      typeof date1 === 'string'
        ? DateTime.fromSQL(date1)
        : DateTime.fromJSDate(date1);

    const dt2 =
      typeof date2 === 'string'
        ? DateTime.fromSQL(date2)
        : DateTime.fromJSDate(date2);

    return Math.abs(dt1.diff(dt2, unit).get(unit));
  }

  /**
   * Checks if the given input is a valid date.
   * If input is a string, it will be parsed as a SQL date string.
   * If input is a Date object, it will be converted to a Luxon DateTime object.
   * @param input - The input to check.
   * @returns True if the input is a valid date, false otherwise.
   */
  public static isValid(input: string | Date): boolean {
    try {
      const dateTime =
        typeof input === 'string'
          ? DateTime.fromSQL(input)
          : DateTime.fromJSDate(input);

      return dateTime.isValid;
    } catch {
      return false;
    }
  }

  /**
   * Returns the current datetime in the specified format and timezone.
   * @param format - The format to use for the datetime string. Defaults to 'yyyy-MM-dd HH:mm:ss'.
   * @param timeZone - The timezone to use for the datetime. If not specified, the local timezone will be used.
   * @returns The current datetime as a string in the specified format and timezone.
   */
  public static now(
    format: string = this.DEFAULT_DATETIME_TZ_FORMAT,
    timeZone?: string
  ): string {
    const dateTime = timeZone
      ? DateTime.now().setZone(timeZone)
      : DateTime.now();

    return dateTime.toFormat(format);
  }
}
