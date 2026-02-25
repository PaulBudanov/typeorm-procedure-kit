/**
 * Represents a single primitive criteria value.
 * Primitive values are strings, numbers and dates.
 */
export type SinglePrimitiveCriteria = string | number | Date;

/**
 * Represents primitive criteria which can be a single primitive value or an array of primitive values.
 */
export type PrimitiveCriteria =
  | SinglePrimitiveCriteria
  | Array<SinglePrimitiveCriteria>;
