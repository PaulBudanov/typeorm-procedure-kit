import type { IProcedureStructuredType } from './procedure.interfaces.js';
import type { TProcedureBindings } from '../types/utility.types.js';

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
  structuredType?: IProcedureStructuredType;
}

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
  /** Logical argument values when driver bindings use an internal representation. */
  logBindings?: TProcedureBindings;
  cursorsNames?: Array<string>;
  outNames?: Array<string>;
  outBindings?: Array<IProcedureOutBinding>;
}

export interface ISqlBindingsObjectReturn {
  /**
   * Positional values for adapters that rewrite placeholders (PostgreSQL), or
   * values keyed by placeholder name for adapters that leave the SQL text
   * alone and let the driver resolve `:NAME` itself (Oracle).
   */
  bindings: TProcedureBindings;
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
