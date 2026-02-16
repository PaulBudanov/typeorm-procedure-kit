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
