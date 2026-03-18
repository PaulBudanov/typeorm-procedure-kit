import { LRUCache } from 'lru-cache';

import { ServerError } from './server-error.js';

export class DatabaseNamingCache<
  U extends
    | Record<string, unknown>
    | Array<unknown>
    | string
    | number
    | boolean,
> {
  private isDestroyed = false;
  private cacheMap = new Map<symbol | string, LRUCache<string, U>>();

  public constructor() {
    process.on('beforeExit', () => void this.destroyCache());
  }

  public destroyCache(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.cacheMap.clear();
  }

  public createCache(key: symbol): symbol {
    if (this.cacheMap.has(key)) return key;
    const cache = new LRUCache<string, U>({
      max: 10000,
      ttl: 1000 * 60 * 60,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });
    this.cacheMap.set(key, cache);
    return key;
  }
  public cacheExists(key: symbol): boolean {
    return this.cacheMap.has(key);
  }

  public cacheGet(cacheKey: symbol, key: string): U | undefined {
    const cache = this.cacheMap.get(cacheKey);
    if (!cache)
      throw new ServerError(
        `Cache with this cacheKey ${String(cacheKey)} not found.`
      );
    return cache.get(key);
  }

  public cacheSet(cacheKey: symbol, key: string, value: U): void {
    const cache = this.cacheMap.get(cacheKey);
    if (!cache)
      throw new ServerError(
        `Cache with this cacheKey ${String(cacheKey)} not found.`
      );
    cache.set(key, value);
    return;
  }

  public cacheHas(cacheKey: symbol, key: string): boolean {
    const cache = this.cacheMap.get(cacheKey);
    if (!cache)
      throw new ServerError(
        `Cache with this cacheKey ${String(cacheKey)} not found.`
      );
    return cache.has(key);
  }

  public cacheClear(key: symbol, isDelete = false): void {
    const cache = this.cacheMap.get(key);
    if (!cache)
      throw new ServerError(
        `Cache with this cacheKey ${String(key)} not found.`
      );
    if (isDelete) {
      this.cacheMap.delete(key);
    } else {
      cache.clear();
    }

    return;
  }
}
