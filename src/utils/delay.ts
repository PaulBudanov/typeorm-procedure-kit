/**
 * Returns a promise that resolves after a specified delay in milliseconds.
 * @param timeMs - The amount of time the promise should wait before resolving in milliseconds.
 * @returns A promise that resolves after the specified delay.
 */
//TODO: Migrate to class
export function delay(timeMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeMs);
  });
}
