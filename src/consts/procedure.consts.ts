/**
 * Marker value emitted by vendor procedure-metadata SQL for a procedure that
 * declares no arguments. Both adapters project this literal instead of a real
 * argument name so that argument-less procedures survive the metadata join.
 */
export const NO_ARGUMENT_SENTINEL = '__tpk_no_argument__';
