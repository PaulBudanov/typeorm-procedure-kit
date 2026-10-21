import { AsyncResource } from 'node:async_hooks';

import { describe, expect, it } from 'vitest';

import { isInKitCall, runInKitCall } from '../../src/utils/kit-call-context.js';

describe('kit call context', (): void => {
  it('is not set outside a kit call', (): void => {
    expect(isInKitCall()).toBe(false);
  });

  it('is set for the whole operation, across its awaits', async (): Promise<void> => {
    const observed = await runInKitCall(async (): Promise<Array<boolean>> => {
      const wasSetBeforeAwait = isInKitCall();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      return [wasSetBeforeAwait, isInKitCall()];
    });

    expect(observed).toEqual([true, true]);
  });

  it('is cleared for the caller once the operation settles', async (): Promise<void> => {
    await runInKitCall(async (): Promise<void> => undefined);
    expect(isInKitCall()).toBe(false);

    await runInKitCall(async (): Promise<void> => {
      throw new Error('operation failed');
    }).catch((): void => undefined);
    expect(isInKitCall()).toBe(false);
  });

  it('resolves with what the operation resolves with', async (): Promise<void> => {
    await expect(
      runInKitCall(async (): Promise<string> => 'rows')
    ).resolves.toBe('rows');
  });

  it('rejects with what the operation rejects with', async (): Promise<void> => {
    const failure = new Error('operation failed');

    await expect(
      runInKitCall(async (): Promise<never> => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });

  it('is not seen by work that runs in a context created before the call', async (): Promise<void> => {
    // An async resource carries the context it was created in, as a pooled socket does.
    const resourceCreatedOutside = new AsyncResource('PooledSocket');

    const isSeenByResource = await runInKitCall(
      async (): Promise<boolean> =>
        resourceCreatedOutside.runInAsyncScope((): boolean => isInKitCall())
    );

    expect(isSeenByResource).toBe(false);
  });
});
