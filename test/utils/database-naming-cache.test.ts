import { describe, expect, it } from 'vitest';

import { DatabaseNamingCache } from '../../src/utils/database-naming-cache.js';
import { ServerError } from '../../src/utils/server-error.js';

describe('DatabaseNamingCache', (): void => {
  it('stores and reads values by cache key', (): void => {
    const cacheKey = Symbol('columns');
    const cache = new DatabaseNamingCache<string>();

    cache.createCache(cacheKey);
    cache.cacheSet(cacheKey, 'USER_ID', 'userId');

    expect(cache.cacheExists(cacheKey)).toBe(true);
    expect(cache.cacheHas(cacheKey, 'USER_ID')).toBe(true);
    expect(cache.cacheGet(cacheKey, 'USER_ID')).toBe('userId');
  });

  it('clears values without deleting the cache by default', (): void => {
    const cacheKey = Symbol('columns');
    const cache = new DatabaseNamingCache<string>();

    cache.createCache(cacheKey);
    cache.cacheSet(cacheKey, 'USER_ID', 'userId');
    cache.cacheClear(cacheKey);

    expect(cache.cacheExists(cacheKey)).toBe(true);
    expect(cache.cacheHas(cacheKey, 'USER_ID')).toBe(false);
  });

  it('throws when reading from a deleted cache', (): void => {
    const cacheKey = Symbol('columns');
    const cache = new DatabaseNamingCache<string>();

    cache.createCache(cacheKey);
    cache.cacheClear(cacheKey, true);

    expect((): void => {
      cache.cacheGet(cacheKey, 'USER_ID');
    }).toThrow(ServerError);
  });
});
