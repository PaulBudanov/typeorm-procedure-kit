import { describe, expect, it } from 'vitest';

import { ServerError } from '../../src/utils/server-error.js';
import { TypeGuards } from '../../src/utils/type-guards.js';

describe('TypeGuards', (): void => {
  it('detects primitive and common runtime types', (): void => {
    expect(TypeGuards.isNullOrUndefined(null)).toBe(true);
    expect(TypeGuards.isPrimitive('value')).toBe(true);
    expect(TypeGuards.isPlainObject({ value: 1 })).toBe(true);
    expect(TypeGuards.isPlainObject(new ServerError('bad'))).toBe(false);
    expect(TypeGuards.isArray([])).toBe(true);
    expect(TypeGuards.isBuffer(Buffer.from('x'))).toBe(true);
    expect(TypeGuards.isBigInt(1n)).toBe(true);
    expect(TypeGuards.isFunction((): void => undefined)).toBe(true);
    expect(TypeGuards.isNumber(Number.NaN)).toBe(false);
    expect(TypeGuards.isString('x')).toBe(true);
    expect(TypeGuards.isBoolean(false)).toBe(true);
    expect(TypeGuards.isDate(new Date('2024-01-01'))).toBe(true);
    expect(TypeGuards.isRegExp(/x/u)).toBe(true);
    expect(TypeGuards.isError(new Error('x'))).toBe(true);
    expect(TypeGuards.isPromise(Promise.resolve())).toBe(true);
  });
});
