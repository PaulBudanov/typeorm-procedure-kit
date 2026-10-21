import { beforeEach, describe, expect, it } from 'vitest';

import { ProcedureResourceTracker } from '../../src/adapters/abstract/procedure-resource-tracker.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';

import type { IResourceLimits } from '../../src/types/config.types.js';

/**
 * Structural view over the process-wide key-size memo cache. The cache is
 * private static state, so these tests reach it through a cast instead of
 * widening the production surface.
 */
interface IKeyCacheOwner {
  readonly MAX_CACHED_KEYS: number;
  readonly keyByteLengths: Map<string, number>;
}

const keyCacheOwner = ProcedureResourceTracker as unknown as IKeyCacheOwner;

function limits(maxProcedureBytes: number): Readonly<IResourceLimits> {
  return { ...DEFAULT_RESOURCE_LIMITS, maxProcedureBytes };
}

describe('ProcedureResourceTracker key cache', (): void => {
  beforeEach((): void => {
    keyCacheOwner.keyByteLengths.clear();
  });

  it('stays bounded while measuring high-cardinality keys', (): void => {
    const maxCachedKeys = keyCacheOwner.MAX_CACHED_KEYS;
    const tracker = new ProcedureResourceTracker(
      'PostgreSQL',
      limits(Number.MAX_SAFE_INTEGER)
    );
    let largestObservedSize = 0;

    for (let index = 0; index < maxCachedKeys * 3; index += 1) {
      tracker.addValue({ [`payload_key_${index}`]: index });
      largestObservedSize = Math.max(
        largestObservedSize,
        keyCacheOwner.keyByteLengths.size
      );
    }

    expect(largestObservedSize).toBeLessThanOrEqual(maxCachedKeys);
  });

  it('keeps caching new keys after the bound is reached', (): void => {
    const maxCachedKeys = keyCacheOwner.MAX_CACHED_KEYS;
    const tracker = new ProcedureResourceTracker(
      'PostgreSQL',
      limits(Number.MAX_SAFE_INTEGER)
    );

    for (let index = 0; index < maxCachedKeys * 2; index += 1) {
      tracker.addValue({ [`payload_key_${index}`]: index });
    }
    tracker.addValue({ hot_column: 1 });

    expect(keyCacheOwner.keyByteLengths.has('hot_column')).toBe(true);
  });

  it('keeps byte accounting exact once the cache has evicted', (): void => {
    const maxCachedKeys = keyCacheOwner.MAX_CACHED_KEYS;
    const churn = new ProcedureResourceTracker(
      'PostgreSQL',
      limits(Number.MAX_SAFE_INTEGER)
    );
    for (let index = 0; index < maxCachedKeys * 2; index += 1) {
      churn.addValue({ [`payload_key_${index}`]: index });
    }

    const row = { 'ключ🙂': 'значение' };
    const expectedBytes =
      Buffer.byteLength('ключ🙂') + Buffer.byteLength('значение');

    expect(() => {
      new ProcedureResourceTracker('Oracle', limits(expectedBytes)).addRow(row);
    }).not.toThrow();
    expect(() => {
      new ProcedureResourceTracker('Oracle', limits(expectedBytes - 1)).addRow(
        row
      );
    }).toThrow(/maxProcedureBytes/);
  });
});
