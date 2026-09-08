import type {
  TProcedureArgumentMode,
  TProcedureStructuredTypeKind,
} from '../types/procedure.types.js';

/** Ordered field metadata for a vendor-owned structured procedure type. */
export interface IProcedureStructuredField {
  name: string;
  argumentType: string;
  order: number;
  /** Database owner/schema of a nested named type, when reported. */
  owner?: string;
  /** PostgreSQL schema of a nested named type, when reported. */
  schema?: string;
  /** Oracle package that declares a nested named type, when reported. */
  packageName?: string;
  /** Nested database type name, when reported. */
  typeName?: string;
  /** PostgreSQL object identifier of a nested named type, when reported. */
  typeOid?: number;
}

/** Metadata required to bind and materialize a named structured argument. */
export interface IProcedureStructuredType {
  kind: TProcedureStructuredTypeKind;
  owner?: string;
  schema?: string;
  packageName?: string;
  typeName: string;
  typeOid?: number;
  fields: Array<IProcedureStructuredField>;
}

export interface IProcedureArgumentBase {
  procedureName: string;
  argumentName: string;
  argumentType: string;
  order: number;
  mode: TProcedureArgumentMode;
  /** Maximum bind size reported by database metadata, when available. */
  size?: number;
  /** Database-specific routine identifier used to distinguish overloads. */
  specificName?: string;
  /** Routine owner/schema reported by database metadata. */
  owner?: string;
  /** Oracle subprogram identifier used to distinguish overloads. */
  subprogramId?: number;
  /** Oracle overload identifier, when present. */
  overload?: string;
  /** Vendor-owned metadata for Oracle records or PostgreSQL composites. */
  structuredType?: IProcedureStructuredType;
}
