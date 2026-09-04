import type { IProcedureArgumentBase } from '../interfaces/procedure.interfaces.js';

export type {
  IProcedureArgumentBase,
  IProcedureStructuredField,
  IProcedureStructuredType,
} from '../interfaces/procedure.interfaces.js';

export type TProcedureArgumentMode = 'IN' | 'OUT' | 'IN/OUT';

export type TProcedureStructuredTypeKind =
  | 'oracle-record'
  | 'postgres-composite';

/** Procedure input payload accepted by database adapters. */
export type TProcedurePayload = object;

/** Public procedure payload argument type. */
export type TProcedurePayloadInput<
  TPayload extends TProcedurePayload = TProcedurePayload,
> = TPayload | null | undefined;

export type TProcedureArgumentList = Record<
  Lowercase<string>,
  Array<Omit<IProcedureArgumentBase, 'procedureName'>>
>;

export type TDBMapStructure = Map<Lowercase<string>, TProcedureArgumentList>;
