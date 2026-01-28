import { LRUCache } from 'lru-cache';

export class DatabaseNamingCache {
  private static cacheMap = new Map<
    symbol | string,
    LRUCache<string, string>
  >();

  public static createCache(key: symbol): symbol {
    if (DatabaseNamingCache.cacheMap.has(key)) return key;
    const cache = new LRUCache<string, string>({
      max: 10000,
      ttl: 1000 * 60 * 60,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });
    DatabaseNamingCache.cacheMap.set(key, cache);
    return key;
  }

  public cacheGet(cacheKey: symbol, key: string): string | undefined {
    const cache = DatabaseNamingCache.cacheMap.get(cacheKey);
    if (!cache)
      throw new Error(
        `Cache with this cacheKey ${String(cacheKey)} not found.`,
      );
    return cache.get(key);
  }

  public cacheSet(cacheKey: symbol, key: string, value: string): void {
    const cache = DatabaseNamingCache.cacheMap.get(cacheKey);
    if (!cache)
      throw new Error(
        `Cache with this cacheKey ${String(cacheKey)} not found.`,
      );
    cache.set(key, value);
    return;
  }

  public cacheHas(cacheKey: symbol, key: string): boolean {
    const cache = DatabaseNamingCache.cacheMap.get(cacheKey);
    if (!cache)
      throw new Error(
        `Cache with this cacheKey ${String(cacheKey)} not found.`,
      );
    return cache.has(key);
  }

  public cacheClear(key: symbol, isDelete = false): void {
    const cache = DatabaseNamingCache.cacheMap.get(key);
    if (!cache)
      throw new Error(`Cache with this cacheKey ${String(key)} not found.`);
    if (isDelete) {
      DatabaseNamingCache.cacheMap.delete(key);
    } else {
      cache.clear();
    }

    return;
  }
}
