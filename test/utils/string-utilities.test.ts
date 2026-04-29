import { describe, expect, it } from 'vitest';

import { StringUtilities } from '../../src/utils/string-utilities.js';

describe('StringUtilities', (): void => {
  it('converts names to camel case', (): void => {
    expect(StringUtilities.toCamelCase('USER_ID')).toBe('userId');
    expect(StringUtilities.toCamelCase('user id')).toBe('userId');
  });

  it('converts names to snake case', (): void => {
    expect(StringUtilities.toSnakeCase('userId')).toBe('user_id');
    expect(StringUtilities.toSnakeCase('User ID')).toBe('user_id');
  });

  it('normalizes undefined lower-case input to an empty string', (): void => {
    expect(StringUtilities.toLowerCase(undefined)).toBe('');
    expect(StringUtilities.toLowerCase('USER_ID')).toBe('user_id');
  });
});
