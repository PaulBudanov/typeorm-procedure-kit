import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsyncUtils } from '../../src/utils/async-utils.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

describe('AsyncUtils', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('resolves delay after the requested timeout', async (): Promise<void> => {
    vi.useFakeTimers();
    const promise = AsyncUtils.delay(100);

    await vi.advanceTimersByTimeAsync(99);
    let resolved = false;
    promise.then((): void => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBeUndefined();
  });

  it('retries until the function succeeds', async (): Promise<void> => {
    vi.useFakeTimers();
    const logger = createLogger();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('ok');

    const promise = AsyncUtils.retry(fn, 2, 10, logger);
    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('throws the last retry error when all attempts fail', async (): Promise<void> => {
    vi.useFakeTimers();
    const logger = createLogger();
    const error = new Error('still failing');
    const promise = AsyncUtils.retry(
      vi.fn<() => Promise<string>>().mockRejectedValue(error),
      2,
      10,
      logger
    );
    promise.catch((): void => undefined);

    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledWith(
      'All 2 attempts failed: still failing'
    );
  });

  it('rejects timeout with ServerError', async (): Promise<void> => {
    vi.useFakeTimers();
    const promise = AsyncUtils.timeout(
      (): Promise<string> => new Promise((): void => undefined),
      25,
      'too slow'
    );
    promise.catch((): void => undefined);

    await vi.advanceTimersByTimeAsync(25);

    await expect(promise).rejects.toBeInstanceOf(ServerError);
    await expect(promise).rejects.toThrow('too slow');
  });
});
