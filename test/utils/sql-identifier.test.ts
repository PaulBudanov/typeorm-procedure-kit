import { describe, expect, it } from 'vitest';

import { ServerError } from '../../src/utils/server-error.js';
import { SqlIdentifier } from '../../src/utils/sql-identifier.js';

describe('SqlIdentifier', (): void => {
  it('trims and validates simple identifiers', (): void => {
    expect(SqlIdentifier.validateIdentifier(' user_id ', 'column')).toBe(
      'user_id'
    );
    expect(SqlIdentifier.validateIdentifier('_ID$1', 'column')).toBe('_ID$1');
  });

  it('rejects unsafe identifiers', (): void => {
    expect((): void => {
      SqlIdentifier.validateIdentifier('user_id; drop table users', 'column');
    }).toThrow(ServerError);
  });

  it('formats qualified identifiers part by part', (): void => {
    expect(
      SqlIdentifier.validateQualifiedIdentifier(' public.users ', 'table')
    ).toBe('public.users');
    expect(
      SqlIdentifier.quotePostgresQualifiedIdentifier(['public', 'users'])
    ).toBe('"public"."users"');
    expect(
      SqlIdentifier.formatOracleQualifiedIdentifier(['app', 'users'])
    ).toBe('APP.USERS');
  });

  it('rejects unsafe qualified identifier parts', (): void => {
    expect((): void => {
      SqlIdentifier.validateQualifiedIdentifier('public.users;', 'table');
    }).toThrow(ServerError);
  });

  it('validates Oracle ROWID values', (): void => {
    expect(SqlIdentifier.validateRowId(' AAAR3sAAEAAAACXAAA ')).toBe(
      'AAAR3sAAEAAAACXAAA'
    );
    expect((): void => {
      SqlIdentifier.validateRowId('AAAR3s;delete');
    }).toThrow(ServerError);
  });
});
