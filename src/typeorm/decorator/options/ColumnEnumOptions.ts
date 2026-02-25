/**
 * Column options for enum-typed columns.
 */
export interface ColumnEnumOptions {
  /**
   * Array of possible enumerated values.
   */
  enum?: Array<unknown> | object;
  /**
   * Exact name of enum
   */
  enumName?: string;
}
