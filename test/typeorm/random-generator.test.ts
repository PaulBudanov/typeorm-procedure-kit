import { describe, expect, it } from 'vitest';

import { RandomGenerator } from '../../src/typeorm/util/RandomGenerator.js';

describe('RandomGenerator', (): void => {
  it('uses the requested native hashing algorithm', (): void => {
    expect(RandomGenerator.hash('Kevin van Zonneveld', 'sha1')).toBe(
      '54916d2e62f65b3afa6e192e6a601cdbe5cb5897'
    );
    expect(RandomGenerator.hash('test', 'sha256')).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    );
  });

  it('rejects unsupported algorithms through node:crypto', (): void => {
    expect(() => RandomGenerator.hash('test', 'not-a-hash')).toThrow();
  });
});
