export interface ISqlError {
  error_code?: number;
  err_code?: number;
  err_text?: string;
  error_text?: string;
}

export interface IBindingsObjectReturn {
  paramExecuteString: string;
  bindings: Array<unknown>;
  cursorsNames: Array<string>;
}

export interface ISqlBindingsObjectReturn extends Pick<
  IBindingsObjectReturn,
  'bindings'
> {
  sqlString: string;
}

export type TFunction<T = unknown> = (...args: Array<unknown>) => T;

export interface IEventBusService {
  emit<T>(event: string | symbol, data: T): void;
  registerListener<T, U extends string | symbol>(
    event: string | symbol,
    callback: (data?: T) => U | void | Promise<void>
  ): void;
  registerOnce<T, U extends string | symbol>(
    event: string | symbol,
    callback: (data?: T) => U | void | Promise<void>
  ): void;
  getListenedEvents(): Array<string>;
  removeListener<T, U>(
    event: string | symbol,
    callback: (data?: T) => U | void | Promise<void>
  ): void;
  removeAllListeners(event: string): void;
}

export type TQueueType = 'array' | 'set' | 'map';
export type TMapKey = string | number | symbol;
export interface ICollectionStrategy<T> {
  enqueue(key: unknown, item: T): void;
  dequeue(key?: unknown): T | undefined;
  clear(): void;
  size(): number;
  getItems(): Array<T> | Map<unknown, T> | Set<T>;
}
