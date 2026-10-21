import type {
  IProcedureQueryLogContext,
  ISqlQueryLogContext,
} from '../interfaces/utility.interfaces.js';

export type {
  IBindingsObjectReturn,
  IProcedureBindingLogItem,
  IProcedureOutBinding,
  IProcedureQueryLogContext,
  IProcedureResult,
  ISqlBindingLogItem,
  ISqlBindingsObjectReturn,
  ISqlError,
  ISqlQueryLogContext,
} from '../interfaces/utility.interfaces.js';

export type TProcedureBindings = Array<unknown> | Record<string, unknown>;

export type TQueryLogContext = IProcedureQueryLogContext | ISqlQueryLogContext;

export type TFunction<T = unknown> = (...args: Array<unknown>) => T;
