import { describe, expect, it, vi } from 'vitest';

import { safeStringify } from '../../src/utils/safe-stringify.js';

describe('safeStringify', (): void => {
  it('does not read object values after the retained key limit', (): void => {
    const firstGetter = vi.fn(() => 'visible');
    const redactedGetter = vi.fn(() => 'secret');
    const omittedGetter = vi.fn(() => 'omitted');
    const value = {};
    Object.defineProperties(value, {
      first: { enumerable: true, get: firstGetter },
      password: { enumerable: true, get: redactedGetter },
      omitted: { enumerable: true, get: omittedGetter },
    });

    expect(safeStringify(value, { maxObjectKeys: 2 })).toBe(
      '{"first":"visible","password":"[REDACTED]","[truncated]":"additional keys omitted"}'
    );
    expect(firstGetter).toHaveBeenCalledOnce();
    expect(redactedGetter).not.toHaveBeenCalled();
    expect(omittedGetter).not.toHaveBeenCalled();
  });

  it('preserves array, depth, and circular limits', (): void => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(
      safeStringify(
        {
          array: ['first', 'second', 'omitted'],
          circular,
          nested: { child: { omitted: true } },
        },
        { maxArrayLength: 2, maxDepth: 2 }
      )
    ).toBe(
      '{"array":["first","second","[1 more items]"],"circular":{"self":"[Circular]"},"nested":{"child":"[MaxDepth]"}}'
    );
  });
});
