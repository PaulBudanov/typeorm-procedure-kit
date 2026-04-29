import { describe, expect, it, vi } from 'vitest';

import { NativeStrategy } from '../../src/case-strategy/native-strategy.js';
import { DatabaseNamingCache } from '../../src/utils/database-naming-cache.js';
import { ServerError } from '../../src/utils/server-error.js';

describe('NativeStrategy', (): void => {
  it('transforms a column name once and reuses the cached value', (): void => {
    const transform = vi.fn((columnName: string): string =>
      columnName.toLowerCase()
    );
    const strategy = new NativeStrategy(
      Symbol('native-columns'),
      transform,
      new DatabaseNamingCache<string>()
    );

    expect(strategy.transformColumnName('USER_ID')).toBe('user_id');
    expect(strategy.transformColumnName('USER_ID')).toBe('user_id');
    expect(transform).toHaveBeenCalledTimes(1);
  });

  it('rejects non-string column names', (): void => {
    const strategy = new NativeStrategy(
      Symbol('native-columns'),
      (columnName: string): string => columnName,
      new DatabaseNamingCache<string>()
    );

    expect((): void => {
      strategy.transformColumnName(42 as unknown as string);
    }).toThrow(ServerError);
  });

  it('destroys the backing cache', (): void => {
    const strategy = new NativeStrategy(
      Symbol('native-columns'),
      (columnName: string): string => columnName,
      new DatabaseNamingCache<string>()
    );

    strategy.transformColumnName('USER_ID');
    strategy.destroy();

    expect((): void => {
      strategy.transformColumnName('USER_ID');
    }).toThrow(ServerError);
  });
});
