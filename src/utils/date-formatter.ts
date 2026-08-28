import { DateTime } from 'luxon';

import { ServerError } from './server-error.js';

export interface IDateTimeZoneOptions {
  /** Zone assigned to strings which do not contain an offset. Defaults to local. */
  sourceZone?: string;
  /** Zone used for the returned value. Omit it to preserve the parsed zone. */
  targetZone?: string;
  /** Require a string input to end in `Z` or a numeric UTC offset. */
  requireZone?: boolean;
}

type TLegacyLocalZoneOption = boolean;

export abstract class DateFormatter {
  private static readonly CALENDAR_DATE_FORMAT = 'yyyy-MM-dd';
  private static readonly DEFAULT_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss';
  private static readonly DEFAULT_TIMESTAMP_FORMAT = 'yyyy-MM-dd HH:mm:ss.SSS';
  private static readonly DEFAULT_TIMESTAMP_TZ_FORMAT =
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
  private static readonly DEFAULT_TIME_FORMAT = 'HH:mm:ss';
  private static readonly STRICT_SQL_OR_ISO_PATTERN =
    /^(?:\d{4}-\d{2}-\d{2}(?:(?:T| )\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)?|\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)(?: ?(?:Z|[+-]\d{2}(?::?\d{2})?))?$/i;
  private static readonly EXPLICIT_ZONE_PATTERN =
    /(?:^|T| )\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)? ?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

  /**
   * Formats a strict SQL/ISO string or native Date.
   *
   * `sourceZone` applies only to strings without an explicit offset.
   * `targetZone` performs an explicit zone conversion after parsing.
   */
  public static formatSqlDate(
    input: string | Date,
    outputFormat?: string,
    options?: IDateTimeZoneOptions
  ): string;

  /**
   * @deprecated Pass `{ targetZone: 'local' }` instead. `true` converts to the
   * local zone and `false` preserves the parsed source zone.
   */
  public static formatSqlDate(
    input: string | Date,
    outputFormat: string,
    shouldSetLocalZone: TLegacyLocalZoneOption
  ): string;

  public static formatSqlDate(
    input: string | Date,
    outputFormat: string = this.DEFAULT_DATE_FORMAT,
    options: IDateTimeZoneOptions | TLegacyLocalZoneOption = {}
  ): string {
    try {
      return this.parseInput(
        input,
        this.normalizeZoneOptions(options)
      ).toFormat(outputFormat);
    } catch (error) {
      throw new ServerError(
        `Error formatting date: ${this.errorMessage(error)}`,
        error,
        { cause: error }
      );
    }
  }

  /** Parses a strict SQL/ISO date string and optionally converts its zone. */
  public static parseSqlDate(
    input: string,
    options?: IDateTimeZoneOptions
  ): DateTime;

  /**
   * @deprecated Pass `{ targetZone: 'local' }` instead. `true` converts to the
   * local zone and `false` preserves the parsed source zone.
   */
  public static parseSqlDate(
    input: string,
    shouldSetLocalZone: TLegacyLocalZoneOption
  ): DateTime;

  public static parseSqlDate(
    input: string,
    options: IDateTimeZoneOptions | TLegacyLocalZoneOption = {}
  ): DateTime {
    return this.parseInput(input, this.normalizeZoneOptions(options));
  }

  /** Formats a calendar date without a time component. */
  public static formatCalendarDate(input: string | Date): string {
    return this.formatSqlDate(input, this.CALENDAR_DATE_FORMAT);
  }

  /** Formats a database DATE while preserving time to whole seconds. */
  public static formatDefaultDate(input: string | Date): string {
    return this.formatSqlDate(input, this.DEFAULT_DATE_FORMAT);
  }

  /** Formats a timezone-less TIMESTAMP while preserving milliseconds. */
  public static formatDefaultDateTime(input: string | Date): string {
    return this.formatSqlDate(input, this.DEFAULT_TIMESTAMP_FORMAT);
  }

  /** Formats a zoned timestamp as a UTC ISO value. */
  public static formatDefaultDateTimeWithTimezone(
    input: string | Date
  ): string {
    return this.formatSqlDate(input, this.DEFAULT_TIMESTAMP_TZ_FORMAT, {
      targetZone: 'UTC',
      requireZone: typeof input === 'string',
    });
  }

  /** Formats a local-time-zone timestamp as a UTC ISO value. */
  public static formatDefaultDateTimeWithLocalTimezone(
    input: string | Date
  ): string {
    return this.formatDefaultDateTimeWithTimezone(input);
  }

  /** Formats the time component of a strict SQL/ISO string or native Date. */
  public static formatTime(input: string | Date): string {
    return this.formatSqlDate(input, this.DEFAULT_TIME_FORMAT);
  }

  /** Converts a date from its explicit/source zone into `timeZone`. */
  public static convertTimeZone(
    input: string | Date,
    timeZone: string,
    format: string = this.DEFAULT_TIMESTAMP_TZ_FORMAT,
    sourceZone?: string
  ): string {
    try {
      return this.parseInput(input, {
        sourceZone,
        targetZone: timeZone,
      }).toFormat(format);
    } catch (error) {
      throw new ServerError(
        `Error converting date: ${this.errorMessage(error)}`,
        error,
        { cause: error }
      );
    }
  }

  /** Calculates the absolute difference between two valid date values. */
  public static diff(
    date1: string | Date,
    date2: string | Date,
    unit: 'days' | 'hours' | 'minutes' | 'seconds' = 'days'
  ): number {
    const dt1 = this.parseInput(date1, {});
    const dt2 = this.parseInput(date2, {});
    return Math.abs(dt1.diff(dt2, unit).get(unit));
  }

  /** Checks whether a value is a strict, in-range date. */
  public static isValid(input: string | Date): boolean {
    try {
      this.parseInput(input, {});
      return true;
    } catch {
      return false;
    }
  }

  /** Returns the current datetime in the requested format and timezone. */
  public static now(
    format: string = this.DEFAULT_TIMESTAMP_FORMAT,
    timeZone?: string
  ): string {
    const dateTime = timeZone
      ? DateTime.now().setZone(timeZone)
      : DateTime.now();
    this.assertValidDateTime(dateTime);
    return dateTime.toFormat(format);
  }

  private static parseInput(
    input: string | Date,
    options: IDateTimeZoneOptions
  ): DateTime {
    let dateTime: DateTime;

    if (typeof input === 'string') {
      const normalizedInput = input.trim();
      if (!this.STRICT_SQL_OR_ISO_PATTERN.test(normalizedInput)) {
        throw new ServerError(`Invalid date syntax: ${input}`);
      }
      if (
        options.requireZone === true &&
        !this.EXPLICIT_ZONE_PATTERN.test(normalizedInput)
      ) {
        throw new ServerError(
          'Zoned date strings must end in Z or a numeric UTC offset'
        );
      }
      this.assertValidNumericOffset(normalizedInput);

      const parseOptions = {
        setZone: true,
        zone: options.sourceZone ?? 'local',
      } as const;
      dateTime = normalizedInput.includes('T')
        ? DateTime.fromISO(normalizedInput, parseOptions)
        : DateTime.fromSQL(normalizedInput, parseOptions);
    } else if (input instanceof Date) {
      dateTime = DateTime.fromJSDate(input);
    } else {
      throw new ServerError('Invalid date value');
    }

    this.assertValidDateTime(dateTime);

    if (options.targetZone) {
      dateTime = dateTime.setZone(options.targetZone);
      this.assertValidDateTime(dateTime);
    }

    return dateTime;
  }

  private static assertValidDateTime(dateTime: DateTime): void {
    if (!dateTime.isValid) {
      throw new ServerError(
        `Invalid date: ${dateTime.invalidReason ?? 'unknown reason'}`
      );
    }
  }

  /**
   * Luxon accepts and normalizes offsets such as `+24:00` and `+99:99`.
   * Reject them before parsing so Oracle temporal inputs stay inside the
   * supported numeric offset range.
   */
  private static assertValidNumericOffset(input: string): void {
    if (!this.EXPLICIT_ZONE_PATTERN.test(input) || /Z$/i.test(input)) return;

    const offset = /([+-])(\d{2})(?::?(\d{2}))?$/.exec(input);
    if (!offset) return;

    const hours = Number(offset[2]);
    const minutes = Number(offset[3] ?? 0);
    if (hours > 14 || minutes >= 60 || (hours === 14 && minutes !== 0)) {
      throw new ServerError(`Invalid numeric UTC offset: ${offset[0]}`);
    }
  }

  private static normalizeZoneOptions(
    options: IDateTimeZoneOptions | TLegacyLocalZoneOption
  ): IDateTimeZoneOptions {
    if (typeof options === 'boolean') {
      return options ? { targetZone: 'local' } : {};
    }
    return options;
  }

  private static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
