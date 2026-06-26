import { describe, expect, it } from 'vitest';

import type { Driver } from '../../src/typeorm/driver/Driver.js';
import { DriverUtils } from '../../src/typeorm/driver/DriverUtils.js';
import { hash } from '../../src/typeorm/util/StringUtils.js';

function createDriverWithMaxAliasLength(maxAliasLength: number): Driver {
  return { maxAliasLength } as Driver;
}

describe('DriverUtils', (): void => {
  it('uses SHA-256 when hashing internal aliases', (): void => {
    expect(hash('alias')).toBe(
      '1a0a6a36ca0a3953b997ddaeb722cb31e9e421b038f6a67ef55593f21dcf92b1'
    );
    expect(hash('alias', { length: 12 })).toBe('1a0a6a36ca0a');
  });

  it('hashes overlong driver aliases without exceeding the driver limit', (): void => {
    const alias = DriverUtils.buildAlias(
      createDriverWithMaxAliasLength(12),
      undefined,
      'message',
      'addSelect',
      'groupBy',
      'orderBy',
      'value',
      'that',
      'exceeds',
      'limit'
    );

    expect(alias).toBe('b78abafd566a');
    expect(alias).toHaveLength(12);
  });

  it('keeps aliases within the driver limit unchanged', (): void => {
    expect(
      DriverUtils.buildAlias(
        createDriverWithMaxAliasLength(32),
        undefined,
        'message',
        'uuid'
      )
    ).toBe('message_uuid');
  });
});
