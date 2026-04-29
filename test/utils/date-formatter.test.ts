import { describe, expect, it } from 'vitest';

import { DateFormatter } from '../../src/utils/date-formatter.js';
import { ServerError } from '../../src/utils/server-error.js';

describe('DateFormatter', (): void => {
  it('formats SQL dates and times', (): void => {
    expect(DateFormatter.formatDefaultDate('2024-01-02')).toBe('2024-01-02');
    expect(DateFormatter.formatTime('2024-01-02 03:04:05')).toBe('03:04:05');
    expect(
      DateFormatter.formatSqlDate('2024-01-02 03:04:05', 'yyyy/MM/dd HH:mm')
    ).toBe('2024/01/02 03:04');
  });

  it('parses dates and rejects invalid input', (): void => {
    expect(DateFormatter.parseSqlDate('2024-01-02').isValid).toBe(true);
    expect((): void => {
      DateFormatter.parseSqlDate('not a date');
    }).toThrow(ServerError);
  });

  it('converts timezone and calculates differences', (): void => {
    expect(
      DateFormatter.convertTimeZone(
        '2024-01-02 00:00:00 +00:00',
        'UTC',
        'yyyy-MM-dd HH:mm'
      )
    ).toBe('2024-01-02 00:00');
    expect(
      DateFormatter.diff('2024-01-01 00:00:00', '2024-01-03 00:00:00')
    ).toBe(2);
  });

  it('checks validity and formats current time', (): void => {
    expect(DateFormatter.isValid('2024-01-02')).toBe(true);
    expect(DateFormatter.isValid('wrong')).toBe(false);
    expect(DateFormatter.now('yyyy', 'UTC')).toMatch(/^\d{4}$/);
  });
});
