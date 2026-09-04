export interface IDateTimeZoneOptions {
  /** Zone assigned to strings which do not contain an offset. Defaults to local. */
  sourceZone?: string;
  /** Zone used for the returned value. Omit it to preserve the parsed zone. */
  targetZone?: string;
  /** Require a string input to end in `Z` or a numeric UTC offset. */
  requireZone?: boolean;
}
