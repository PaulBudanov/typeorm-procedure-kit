import { describe, expect, it } from 'vitest';

import { ServerError } from '../../src/utils/server-error.js';

describe('ServerError', (): void => {
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
    expect(error.unsafeGetContextAs<{ payload: boolean }>()).toEqual({
      payload: true,
    });
    expect(error.timestamp).toBeInstanceOf(Date);
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
    expect(wrapped.unsafeGetContextAs<Error>()).toBe(nodeError);

    expect(
      ServerError.ENSURE_SERVER_ERROR({ error: { code: 1 } }).message
    ).toBe('{"code":1}');
  });
});
