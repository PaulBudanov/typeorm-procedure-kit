import { describe, expect, it } from 'vitest';

import { PostgrePortalName } from '../../src/adapters/postgres/postgre-portal-name.js';

describe('PostgrePortalName', (): void => {
  const portalNames = new PostgrePortalName();

  it.each([undefined, null, '', '   '])(
    'generates a safe name for an empty input: %j',
    (value): void => {
      expect(portalNames.normalizeInput(value, 'cursor')).toMatch(
        /^tpk_[0-9a-f_]+$/
      );
    }
  );

  it.each([
    '<unnamed portal>',
    '<unnamed portal 1>',
    '<UNNAMED PORTAL 42>',
    '<unnamed portal future-name>',
    ' < unnamed   portal implementation-defined > ',
  ])('rejects PostgreSQL unnamed portal variant %j', (value): void => {
    expect(() => portalNames.normalizeInput(value, 'cursor')).toThrow(
      'Unsafe PostgreSQL portal name'
    );
    expect(() => portalNames.assertReturned(value, 'cursor')).toThrow(
      'must return an explicit portal name'
    );
  });

  it('enforces the UTF-8 byte limit and rejects control characters', (): void => {
    expect(portalNames.normalizeInput(`${'я'.repeat(31)}a`, 'cursor')).toBe(
      `${'я'.repeat(31)}a`
    );
    expect(() =>
      portalNames.normalizeInput(`${'я'.repeat(31)}ab`, 'cursor')
    ).toThrow('Unsafe PostgreSQL portal name');
    expect(() =>
      portalNames.normalizeInput('portal\u0085name', 'cursor')
    ).toThrow('Unsafe PostgreSQL portal name');
  });

  it('quotes embedded identifier quotes', (): void => {
    expect(portalNames.quote('portal"name')).toBe('"portal""name"');
  });
});
