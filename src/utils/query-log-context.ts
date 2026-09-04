import { AsyncLocalStorage } from 'async_hooks';

import type { TQueryLogContext } from '../types/utility.types.js';

class QueryLogContextStorageApi {
  private readonly storage = new AsyncLocalStorage<TQueryLogContext>();

  public run<T>(context: TQueryLogContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  public getStore(): TQueryLogContext | undefined {
    return this.storage.getStore();
  }
}

const queryLogContextStorage = new QueryLogContextStorageApi();

export { queryLogContextStorage as QueryLogContextStorage };
