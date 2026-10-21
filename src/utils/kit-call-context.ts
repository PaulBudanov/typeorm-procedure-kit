import { AsyncLocalStorage } from 'async_hooks';

/**
 * Marks the asynchronous scope of one kit call: `call()`, `callSqlTransaction()` and the kit's
 * own metadata queries, all of which run through `ExecuteBase`. Result checks read the mark to
 * decide whether a defect in a result is the kit's error to raise or another query's to report.
 *
 * Private to the package and separate from `QueryLogContextStorage`, so nothing outside the kit
 * can set it.
 */
const kitCallStorage = new AsyncLocalStorage<true>();

/**
 * Runs an operation as part of a kit call.
 *
 * Every asynchronous resource created while the operation runs inherits the mark, a pooled
 * socket included, and keeps it after the operation settles. Acquire connections before calling
 * this, so that a socket the pool opens is not marked for whoever reuses it later.
 * @param fn - the operation; the mark covers it and everything it awaits.
 * @returns what the operation resolves with, or its rejection.
 */
export function runInKitCall<T>(fn: () => Promise<T>): Promise<T> {
  return kitCallStorage.run(true, fn);
}

/**
 * Reports whether the current asynchronous context belongs to a kit call.
 * @returns true inside an operation started by `runInKitCall`.
 */
export function isInKitCall(): boolean {
  return kitCallStorage.getStore() === true;
}
