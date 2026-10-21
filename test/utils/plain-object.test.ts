import { describe, expect, it } from 'vitest';

import { isPlainObject } from '../../src/utils/plain-object.js';

class SampleClass {
  public constructor(public readonly field: string) {}
}

describe('isPlainObject', (): void => {
  it('accepts an object literal', (): void => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ field: 1 })).toBe(true);
    expect(isPlainObject(JSON.parse('{"field":1}'))).toBe(true);
  });

  it('accepts a null-prototype object', (): void => {
    const nullPrototype: Record<string, unknown> = Object.create(
      null
    ) as Record<string, unknown>;
    nullPrototype['field'] = 1;

    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(nullPrototype)).toBe(true);
  });

  it('rejects null and undefined', (): void => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });

  it('rejects arrays', (): void => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([{ field: 1 }])).toBe(false);
  });

  it('rejects Date and Buffer', (): void => {
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(Buffer.from('x'))).toBe(false);
  });

  it('rejects class instances', (): void => {
    expect(isPlainObject(new SampleClass('value'))).toBe(false);
    expect(isPlainObject(new Error('boom'))).toBe(false);
  });

  it('rejects Map and Set', (): void => {
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject(new Set())).toBe(false);
  });

  it('rejects functions', (): void => {
    expect(isPlainObject((): void => undefined)).toBe(false);
    expect(isPlainObject(SampleClass)).toBe(false);
  });

  it('rejects primitives', (): void => {
    expect(isPlainObject('x')).toBe(false);
    expect(isPlainObject(0)).toBe(false);
    expect(isPlainObject(false)).toBe(false);
    expect(isPlainObject(Symbol('x'))).toBe(false);
    expect(isPlainObject(1n)).toBe(false);
  });

  it('rejects a boxed primitive and other exotic objects', (): void => {
    expect(isPlainObject(new String('x'))).toBe(false);
    expect(isPlainObject(Object.create({ inherited: 1 }))).toBe(false);
    expect(isPlainObject(Promise.resolve())).toBe(false);
  });

  it('narrows the value to a record for the caller', (): void => {
    const value: unknown = { field: 'value' };

    if (!isPlainObject(value)) throw new Error('expected a plain object');

    expect(Object.keys(value)).toStrictEqual(['field']);
    expect(value['field']).toBe('value');
  });
});
