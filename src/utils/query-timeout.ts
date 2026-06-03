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
