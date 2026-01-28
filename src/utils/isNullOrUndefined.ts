/**
 * Checks if the given value is either null or undefined.
 * @param value The value to check.
 * @returns True if the value is null or undefined, false otherwise.
 */
//TODO: Migrate to class
export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}
