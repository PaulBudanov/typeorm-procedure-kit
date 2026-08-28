export interface ISqlError {
  error_code?: number | string;
  err_code?: number | string;
  errorCode?: number | string;
  errCode?: number | string;
  err_text?: string;
  error_text?: string;
  errText?: string;
  errorText?: string;
}
export interface IProcedureOutBinding {
  name: string;
  type: 'cursor' | 'scalar' | 'lob' | 'object' | 'array';
  databaseType?: string;
}
export type TProcedureBindings = Array<unknown> | Record<string, unknown>;

/**
 * Result of a stored procedure call.
 *
 * Cursor rows are exposed both as a metadata-ordered flattened `rows` array and
 * under their transformed output-bind name in `outBinds`. Scalar OUT and IN/OUT
 * values are preserved only in `outBinds`.
 */
export interface IProcedureResult<
  TRow,
  TOut extends Record<string, unknown> = Record<string, unknown>,
> {
  rows: Array<TRow>;
  outBinds: TOut;
}

//TODO: Add in the future support for another out bindings, at now added new object keys for this.
export interface IBindingsObjectReturn {
  paramExecuteString: string;
  bindings: TProcedureBindings;
  cursorsNames?: Array<string>;
  outNames?: Array<string>;
  outBindings?: Array<IProcedureOutBinding>;
}

export interface ISqlBindingsObjectReturn {
  bindings: Array<unknown>;
  sqlString: string;
}

export interface IProcedureBindingLogItem {
  name: string;
  type: string;
  mode: string;
  value?: unknown;
  isCursor?: boolean;
}

export interface IProcedureQueryLogContext {
  kind: 'procedure';
  packageName: string;
  procedureName: string;
  bindings: Array<IProcedureBindingLogItem>;
}

export interface ISqlBindingLogItem {
  name: string;
  value: unknown;
}

export interface ISqlQueryLogContext {
  kind: 'sql';
  bindings: Array<ISqlBindingLogItem>;
}

export type TQueryLogContext = IProcedureQueryLogContext | ISqlQueryLogContext;

export type TFunction<T = unknown> = (...args: Array<unknown>) => T;

export interface IEventBusService {
  emit<T>(event: string | symbol, data: T): void;
  emitAsync<T>(event: string | symbol, data: T): Promise<void>;
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
