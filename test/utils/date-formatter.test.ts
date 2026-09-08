import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { DateFormatter } from '../../src/utils/date-formatter.js';
import { ServerError } from '../../src/utils/server-error.js';

describe('DateFormatter', (): void => {
  it('formats each v3 temporal contract without losing supported precision', (): void => {
    expect(DateFormatter.formatCalendarDate('2024-01-02 03:04:05')).toBe(
      '2024-01-02'
    );
    expect(DateFormatter.formatDefaultDate('2024-01-02 03:04:05.987')).toBe(
      '2024-01-02 03:04:05'
    );
    expect(
      DateFormatter.formatDefaultDateTime('2024-01-02 03:04:05.987654')
    ).toBe('2024-01-02 03:04:05.987');
    expect(
      DateFormatter.formatDefaultDateTimeWithTimezone(
        '2024-01-02 03:04:05.678 +03:00'
      )
    ).toBe('2024-01-02T00:04:05.678Z');
    expect(
      DateFormatter.formatDefaultDateTimeWithLocalTimezone(
        '2024-01-02T03:04:05.678Z'
      )
    ).toBe('2024-01-02T03:04:05.678Z');
  });

  it('formats native Date values and never requires a string round trip', (): void => {
    const localDate = new Date(2024, 0, 2, 3, 4, 5, 678);
    const instant = new Date('2024-01-02T03:04:05.678Z');

    expect(DateFormatter.formatDefaultDate(localDate)).toBe(
      '2024-01-02 03:04:05'
    );
    expect(DateFormatter.formatDefaultDateTime(localDate)).toBe(
      '2024-01-02 03:04:05.678'
    );
    expect(DateFormatter.formatDefaultDateTimeWithTimezone(instant)).toBe(
      '2024-01-02T03:04:05.678Z'
    );
  });

  it('uses explicit source and target zones', (): void => {
    expect(
      DateFormatter.formatSqlDate(
        '2024-01-02 03:04:05',
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        { sourceZone: 'Europe/Moscow', targetZone: 'UTC' }
      )
    ).toBe('2024-01-02T00:04:05Z');
    expect(
      DateFormatter.convertTimeZone(
        '2024-01-02 00:00:00 +00:00',
        'Europe/Moscow',
        'yyyy-MM-dd HH:mm Z'
      )
    ).toBe('2024-01-02 03:00 +3');
  });

  it('normalizes positive and negative half-hour offsets to UTC', (): void => {
    expect(
      DateFormatter.formatDefaultDateTimeWithTimezone(
        '2024-01-02 03:04:05.678 +05:30'
      )
    ).toBe('2024-01-01T21:34:05.678Z');
    expect(
      DateFormatter.formatDefaultDateTimeWithTimezone(
        '2024-01-02 03:04:05.678 -03:30'
      )
    ).toBe('2024-01-02T06:34:05.678Z');
  });

  it('keeps the deprecated boolean wrapper semantically correct', (): void => {
    const preserved = DateFormatter.formatSqlDate(
      '2024-01-02 03:04:05 +05:00',
      'Z',
      false
    );
    const converted = DateFormatter.formatSqlDate(
      '2024-01-02 03:04:05 +05:00',
      'Z',
      true
    );

    expect(preserved).toBe('+5');
    expect(converted).toBe(DateTime.local().toFormat('Z'));
  });

  it('rejects invalid syntax, overflow, invalid Date, and missing zones', (): void => {
    for (const invalidValue of [
      'not a date',
      '2024-02-31 03:04:05',
      '2024-01-02 trailing',
    ]) {
      expect((): void => {
        DateFormatter.parseSqlDate(invalidValue);
      }).toThrow(ServerError);
    }

    expect((): void => {
      DateFormatter.formatDefaultDate(new Date(Number.NaN));
    }).toThrow(ServerError);
    expect((): void => {
      DateFormatter.formatDefaultDateTimeWithTimezone('2024-01-02 03:04:05');
    }).toThrow('must end in Z or a numeric UTC offset');
    expect((): void => {
      DateFormatter.formatDefaultDateTimeWithTimezone('2024-01-02');
    }).toThrow('must end in Z or a numeric UTC offset');
    expect((): void => {
      DateFormatter.formatDefaultDateTimeWithTimezone(
        '2024-01-02 03:04:05 Europe/Moscow'
      );
    }).toThrow(ServerError);
    for (const invalidOracleOffset of ['+14:30', '+24:00', '+99:99']) {
      expect((): void => {
        DateFormatter.formatDefaultDateTimeWithTimezone(
          `2024-01-02 03:04:05 ${invalidOracleOffset}`
        );
      }).toThrow(ServerError);
    }
  });

  it('supports strict validation, time formatting, differences, and now', (): void => {
    expect(DateFormatter.isValid('2024-02-29 12:00:00')).toBe(true);
    expect(DateFormatter.isValid('2023-02-29 12:00:00')).toBe(false);
    expect(DateFormatter.isValid(new Date(Number.NaN))).toBe(false);
    expect(DateFormatter.formatTime('03:04:05.678')).toBe('03:04:05');
    expect(
      DateFormatter.diff('2024-01-01 00:00:00', '2024-01-03 00:00:00')
    ).toBe(2);
    expect(DateFormatter.now('yyyy', 'UTC')).toMatch(/^\d{4}$/);
  });
});
