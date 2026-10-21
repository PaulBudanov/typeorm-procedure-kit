import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServerError } from '../../src/utils/server-error.js';

describe('ServerError', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('stamps each error with the instant it was constructed', (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.678Z'));
    const first = new ServerError('first');
    vi.setSystemTime(new Date('2026-01-02T03:04:06.000Z'));
    const second = new ServerError('second');

    expect(first.timestamp).toBeInstanceOf(Date);
    expect(first.timestamp.toISOString()).toBe('2026-01-02T03:04:05.678Z');
    expect(second.timestamp.toISOString()).toBe('2026-01-02T03:04:06.000Z');
    expect(first.toJSON().timestamp).toBe('2026-01-02T03:04:05.678Z');
  });

  it('creates errors with ids and context', (): void => {
    const error = new ServerError(
      'broken',
      { payload: true },
      {
        errorId: 'err-1',
      }
    );

    expect(error.name).toBe('ServerError');
    expect(error.errorId).toBe('err-1');
    expect(error.errorContext).toEqual({
      payload: true,
    });
    expect(error.timestamp).toBeInstanceOf(Date);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'ServerError',
      message: 'broken',
      errorId: 'err-1',
      timestamp: error.timestamp.toISOString(),
    });
    expect(Object.keys(error)).not.toContain('errorContext');
    expect(Object.keys(error)).not.toContain('options');
  });

  it('returns existing ServerError instances', (): void => {
    const error = new ServerError('broken');

    expect(ServerError.ENSURE_SERVER_ERROR({ error, message: 'ignored' })).toBe(
      error
    );
  });

  it('wraps regular errors and unknown values', (): void => {
    const nodeError = new Error('node');
    const wrapped = ServerError.ENSURE_SERVER_ERROR({
      error: nodeError,
      errorId: 'node-id',
    });

    expect(wrapped.message).toBe('node');
    expect(wrapped.errorId).toBe('node-id');
    expect(wrapped.errorContext).toBe(nodeError);

    expect(
      ServerError.ENSURE_SERVER_ERROR({ error: { code: 1 } }).message
    ).toBe('{"code":1}');
  });

  it('preserves the original stack and complete cause chain', (): void => {
    const rootCause = new Error('connection failed');
    const original = new Error('driver failed', { cause: rootCause });
    original.stack = 'Error: driver failed\n    at original-driver.js:42:1';
    const wrapped = ServerError.ENSURE_SERVER_ERROR({ error: original });

    expect(wrapped.stack).toBe(original.stack);
    expect(wrapped.cause).toBe(original);
    expect(original.cause).toBe(rootCause);
    expect(wrapped.errorContext).toBe(original);
    expect(Object.keys(wrapped.toJSON())).toEqual([
      'name',
      'message',
      'errorId',
      'timestamp',
    ]);
  });

  it('applies an explicitly supplied stack', (): void => {
    const error = new ServerError('wrapped', undefined, {
      stack: 'custom stack',
    });

    expect(error.stack).toBe('custom stack');
  });
});
