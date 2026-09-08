import { describe, expect, it } from 'vitest';

import { ProcedureResourceTracker } from '../../src/adapters/abstract/procedure-resource-tracker.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';

import type { IResourceLimits } from '../../src/types/config.types.js';

function limits(maxProcedureBytes: number): Readonly<IResourceLimits> {
  return { ...DEFAULT_RESOURCE_LIMITS, maxProcedureBytes };
}

function measuredRecordBytes(record: Record<string, unknown>): number {
  let bytes = 0;
  for (const [key, value] of Object.entries(record)) {
    bytes += Buffer.byteLength(key);
    if (typeof value === 'string') bytes += Buffer.byteLength(value);
    else if (typeof value === 'number' || typeof value === 'bigint')
      bytes += String(value).length;
    else if (typeof value === 'boolean') bytes += 1;
    else if (Buffer.isBuffer(value)) bytes += value.byteLength;
    else if (value instanceof Date) bytes += value.toISOString().length;
  }
  return bytes;
}

describe('ProcedureResourceTracker', (): void => {
  it('keeps exact UTF-8 and numeric accounting on the flat-row fast path', (): void => {
    const row = {
      'ключ🙂': 'значение🙂\ud800',
      small: 9,
      boundary: 10,
      negative: -1_000,
      fraction: 1.25,
      enabled: true,
      bytes: Buffer.from([1, 2, 3]),
      date: new Date('2026-01-02T03:04:05.678Z'),
    };
    const expectedBytes = measuredRecordBytes(row);

    expect(() => {
      new ProcedureResourceTracker('PostgreSQL', limits(expectedBytes)).addRow(
        row
      );
    }).not.toThrow();
    expect(() => {
      new ProcedureResourceTracker(
        'PostgreSQL',
        limits(expectedBytes - 1)
      ).addRow(row);
    }).toThrow('resourceLimits.maxProcedureBytes');
  });

  it('invalidates the row-shape cache without missing added or removed keys', (): void => {
    const first = { id: 1, label: 'one' };
    const second = { id: 20, state: 'new', extra: true };
    const third = { id: 300 };
    const expectedBytes =
      measuredRecordBytes(first) +
      measuredRecordBytes(second) +
      measuredRecordBytes(third);
    const tracker = new ProcedureResourceTracker(
      'Oracle',
      limits(expectedBytes)
    );

    expect(() => {
      tracker.addRow(first);
      tracker.addRow(second);
      tracker.addRow(third);
    }).not.toThrow();

    const rejectingTracker = new ProcedureResourceTracker(
      'Oracle',
      limits(expectedBytes - 1)
    );
    expect(() => {
      rejectingTracker.addRow(first);
      rejectingTracker.addRow(second);
      rejectingTracker.addRow(third);
    }).toThrow('resourceLimits.maxProcedureBytes');
  });

  it('falls back to cycle-safe graph accounting for nested rows', (): void => {
    const nested: Record<string, unknown> = { value: 'ok' };
    nested.self = nested;
    const row = { id: 1, nested };
    const expectedBytes =
      Buffer.byteLength('id') +
      String(row.id).length +
      Buffer.byteLength('nested') +
      Buffer.byteLength('value') +
      Buffer.byteLength('ok') +
      Buffer.byteLength('self');

    expect(() => {
      new ProcedureResourceTracker('PostgreSQL', limits(expectedBytes)).addRow(
        row
      );
    }).not.toThrow();
    expect(() => {
      new ProcedureResourceTracker(
        'PostgreSQL',
        limits(expectedBytes - 1)
      ).addRow(row);
    }).toThrow('resourceLimits.maxProcedureBytes');
  });

  it('measures a graph deeper than the JavaScript call stack', (): void => {
    const root: Record<string, unknown> = {};
    let current = root;
    for (let depth = 0; depth < 20_000; depth += 1) {
      const next: Record<string, unknown> = {};
      current.next = next;
      current = next;
    }
    current.value = 'done';
    const expectedBytes =
      20_000 * Buffer.byteLength('next') +
      Buffer.byteLength('value') +
      Buffer.byteLength('done');

    expect(() => {
      new ProcedureResourceTracker('Oracle', limits(expectedBytes)).addValue(
        root
      );
    }).not.toThrow();
  });
});
