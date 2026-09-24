import { ServerError } from '../../utils/server-error.js';

import type { TProcedurePayload } from '../../types/procedure.types.js';

/**
 * Resolves the payload value for one procedure argument. Shared by the Oracle
 * and PostgreSQL bindings, so both vendors read a payload by the same rule;
 * `vendorName` only names the vendor in error messages.
 *
 * An array payload is read by argument position. A named payload counts a key
 * as supplied when it carries the key as an own property with a value other
 * than `undefined`: an explicit `null` is a value the caller chose, while
 * `undefined` is the absent optional property of a spread object. Both the
 * declared argument name and its `p_`-stripped alias are accepted, but
 * supplying both is a conflict rather than a silent preference for one of
 * them.
 *
 * Only own properties are read. A key the payload inherits from a prototype
 * of its own, such as a getter of a class DTO, is rejected instead of being
 * bound as `NULL`; see `hasPayloadValue`.
 */
export function readPayloadValue(
  payload: TProcedurePayload | null | undefined,
  index: number,
  argumentName: string,
  vendorName: 'Oracle' | 'PostgreSQL'
): unknown {
  if (Array.isArray(payload)) return payload[index] ?? null;
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const aliasName = argumentName.replace(/^p_/, '');
  const hasAlias =
    aliasName !== argumentName &&
    hasPayloadValue(record, aliasName, argumentName, vendorName);
  const hasArgumentName = hasPayloadValue(
    record,
    argumentName,
    argumentName,
    vendorName
  );
  if (hasAlias && hasArgumentName) {
    throw new ServerError(
      `Conflicting ${vendorName} procedure payload keys: "${aliasName}" and "${argumentName}"`
    );
  }
  if (hasAlias) return record[aliasName];
  if (hasArgumentName) return record[argumentName];
  return null;
}

/**
 * Whether the payload supplies `key` for `argumentName`: an own property
 * with a value other than `undefined`. A key the payload does not own is
 * never read, so it cannot answer with `__proto__` or `toString`.
 *
 * A key it inherits from a prototype other than `Object.prototype` — a
 * getter, a method or a data property that a class or a prototype object
 * defines — is rejected: binding `NULL` there would drop in silence a value
 * the caller can read on the object. `Object.prototype` members and the
 * `constructor` back-reference that every class prototype carries are not
 * caller data and count as absent.
 */
function hasPayloadValue(
  record: Record<string, unknown>,
  key: string,
  argumentName: string,
  vendorName: 'Oracle' | 'PostgreSQL'
): boolean {
  if (Object.hasOwn(record, key)) return record[key] !== undefined;
  if (isDefinedOnPayloadPrototype(record, key)) {
    throw new ServerError(
      `Inherited ${vendorName} procedure payload key "${key}" for argument "${argumentName}": only own properties are read, so pass it as an own property, for example by copying it into a plain object`
    );
  }
  return false;
}

/**
 * Whether `key` resolves on a prototype of `record` that is not
 * `Object.prototype`, as anything but the `constructor` back-reference of
 * that prototype. The walk stops at the first prototype that owns `key`, the
 * one a property read would answer from, and at `Object.prototype`.
 */
function isDefinedOnPayloadPrototype(record: object, key: string): boolean {
  for (
    let prototype = Object.getPrototypeOf(record) as object | null;
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor === undefined) continue;
    const value: unknown = descriptor.value;
    const isConstructorBackReference =
      key === 'constructor' &&
      typeof value === 'function' &&
      value.prototype === prototype;
    return !isConstructorBackReference;
  }
  return false;
}
