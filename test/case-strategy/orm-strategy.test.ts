import { describe, expect, it, vi } from 'vitest';

import { OrmStrategy } from '../../src/case-strategy/orm-strategy.js';
import { DatabaseNamingCache } from '../../src/utils/database-naming-cache.js';
import { ServerError } from '../../src/utils/server-error.js';

describe('OrmStrategy', (): void => {
  it('transforms and caches ORM column names', (): void => {
    const transform = vi.fn((value: string): string => value.toLowerCase());
    const strategy = new OrmStrategy(
      Symbol('orm-columns'),
      transform,
      new DatabaseNamingCache<string>()
    );

    expect(strategy.columnName('USER_ID', '', [])).toBe('user_id');
    expect(strategy.columnName('USER_ID', '', [])).toBe('user_id');
    expect(transform).toHaveBeenCalledTimes(2);
  });

  it('preserves custom name behavior from the default naming strategy', (): void => {
    const strategy = new OrmStrategy(
      Symbol('orm-columns'),
      (value: string): string => value.toLowerCase(),
      new DatabaseNamingCache<string>()
    );

    expect(strategy.columnName('USER_ID', 'custom_id', ['embedded'])).toBe(
      'embeddedCustom_id'
    );
  });

  it('throws after the backing cache is destroyed', (): void => {
    const strategy = new OrmStrategy(
      Symbol('orm-columns'),
      (value: string): string => value,
      new DatabaseNamingCache<string>()
    );

    strategy.destroy();

    expect((): void => {
      strategy.columnName('USER_ID', '', []);
    }).toThrow(ServerError);
  });
});
