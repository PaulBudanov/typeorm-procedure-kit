export type TProcedureArgumentMode = 'IN' | 'OUT' | 'IN/OUT';

export interface IProcedureArgumentBase {
  procedureName: string;
  argumentName: string;
  argumentType: string;
  order: number;
  mode: TProcedureArgumentMode;
  /** Maximum bind size reported by database metadata, when available. */
  size?: number;
}

/**
 * Procedure input payload accepted by database adapters.
 *
 * Objects bind values by argument name, arrays bind values by argument order,
 * and scalar strings/numbers are rejected at runtime by the adapters.
 */
export type TProcedurePayload = object;

/**
 * Public procedure payload argument type. Null and undefined mean that
 * non-cursor procedure arguments are bound as null.
 */
export type TProcedurePayloadInput<
  TPayload extends TProcedurePayload = TProcedurePayload,
> = TPayload | null | undefined;

export type TProcedureArgumentList = Record<
  Lowercase<string>,
  Array<Omit<IProcedureArgumentBase, 'procedureName'>>
>;

export type TDBMapStructure = Map<Lowercase<string>, TProcedureArgumentList>;
