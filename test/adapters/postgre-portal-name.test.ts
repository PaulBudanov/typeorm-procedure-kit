import { describe, expect, it } from 'vitest';

import {
  PostgrePortalName,
  PostgreUnnamedPortalError,
} from '../../src/adapters/postgres/postgre-portal-name.js';

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
    '<unnamed portal >',
    '<\u00a0unnamed\u2003portal\u00a0future name >',
  ])('rejects PostgreSQL unnamed portal variant %j', (value): void => {
    expect(() => portalNames.normalizeInput(value, 'cursor')).toThrow(
      'Unsafe PostgreSQL portal name'
    );
    expect(() => portalNames.assertReturned(value, 'cursor')).toThrow(
      'must return an explicit portal name'
    );
    try {
      portalNames.assertReturned(value, 'cursor');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PostgreUnnamedPortalError);
      if (error instanceof PostgreUnnamedPortalError)
        expect(error.portalName).toBe(value);
    }
  });

  it.each([
    '<unnamed portals>',
    '<unnamed portal_suffix>',
    '<unnamed portal 1>>',
    'named portal',
    '<unnamed portal\t1>',
  ])('preserves named portals and rejects controls in %j', (value): void => {
    if (value.includes('\t')) {
      expect(() => portalNames.assertReturned(value, 'cursor')).toThrow(
        'Unsafe PostgreSQL portal name'
      );
    } else {
      expect(portalNames.normalizeInput(value, 'cursor')).toBe(value);
      expect(portalNames.assertReturned(value, 'cursor')).toBe(value);
    }
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
