import { describe, expect, it } from 'vitest';

import { DateFormatter } from '../../src/index.js';

describe('v3 public temporal contract', (): void => {
  it('normalizes explicit offsets across DST gaps and overlaps', (): void => {
    expect(
      DateFormatter.formatDefaultDateTimeWithTimezone(
        '2024-03-31 01:30:00.123 +01:00'
      )
    ).toBe('2024-03-31T00:30:00.123Z');
    expect(
      DateFormatter.formatDefaultDateTimeWithTimezone(
        '2024-03-31 03:30:00.123 +02:00'
      )
    ).toBe('2024-03-31T01:30:00.123Z');

    const firstOverlapInstant = DateFormatter.formatDefaultDateTimeWithTimezone(
      '2024-10-27 02:30:00.123 +02:00'
    );
    const secondOverlapInstant =
      DateFormatter.formatDefaultDateTimeWithTimezone(
        '2024-10-27 02:30:00.123 +01:00'
      );

    expect(firstOverlapInstant).toBe('2024-10-27T00:30:00.123Z');
    expect(secondOverlapInstant).toBe('2024-10-27T01:30:00.123Z');
    expect(firstOverlapInstant).not.toBe(secondOverlapInstant);
  });
});
