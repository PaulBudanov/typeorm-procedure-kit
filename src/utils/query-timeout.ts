export function normalizeQueryTimeoutMs(
  queryTimeoutMs: number | undefined
): number | undefined {
  if (
    queryTimeoutMs === undefined ||
    !Number.isFinite(queryTimeoutMs) ||
    !Number.isInteger(queryTimeoutMs) ||
    queryTimeoutMs <= 0
  ) {
    return undefined;
  }
  return queryTimeoutMs;
}

export function assertValidQueryTimeoutMs(
  queryTimeoutMs: number | undefined
): void {
  if (queryTimeoutMs === undefined) return;
  if (
    !Number.isSafeInteger(queryTimeoutMs) ||
    queryTimeoutMs <= 0 ||
    queryTimeoutMs > 2_147_483_647
  ) {
    throw new RangeError(
      'queryTimeoutMs must be an integer between 1 and 2147483647'
    );
  }
}
