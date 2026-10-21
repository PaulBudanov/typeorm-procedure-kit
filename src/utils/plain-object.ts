/**
 * The single answer to "is this a bag of named fields?" for procedure payloads and serializer
 * input.
 *
 * Prototype-based on purpose: a value counts as a plain object only when its prototype is
 * `Object.prototype` (an object literal, `JSON.parse` output, a spread copy) or `null`
 * (`Object.create(null)`). Everything else — `null`, `undefined`, primitives, functions, arrays,
 * `Date`, `Buffer`, `Map`, `Set`, and any class instance — is a scalar or an opaque value and must
 * be bound or rejected as such.
 *
 * A blacklist ("not a Date, not an array, ...") would let an arbitrary class instance through and
 * is deliberately not used here. Note that a cross-realm object literal fails this check, which is
 * the intended strictness: such a value cannot be trusted to be a field bag either.
 *
 * Module-internal: deliberately not re-exported by `src/utils/index.ts` or any other barrel.
 */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
