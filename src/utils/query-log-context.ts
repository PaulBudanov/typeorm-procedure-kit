import { AsyncLocalStorage } from 'async_hooks';

import type { TQueryLogContext } from '../types/utility.types.js';

export class QueryLogContextStorage {
  private static readonly storage = new AsyncLocalStorage<TQueryLogContext>();

  public static run<T>(context: TQueryLogContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  public static getStore(): TQueryLogContext | undefined {
    return this.storage.getStore();
  }
}
