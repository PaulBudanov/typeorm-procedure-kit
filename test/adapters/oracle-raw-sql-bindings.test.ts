import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
import { createLogger } from '../support/helpers.js';

function createOracleAdapter(): OracleAdapter {
  return new OracleAdapter(
    {
      options: { replication: { master: {} } },
      driver: {
        version: '19.0.0.0.0',
        setFetchTypeHandler: vi.fn(),
      },
    } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string => value.toLowerCase(),
      },
      resourceLimits: { ...DEFAULT_RESOURCE_LIMITS },
    }
  );
}

describe('OracleAdapter raw SQL bindings', (): void => {
  it('binds a placeholder repeated in the query exactly once', (): void => {
    const adapter = createOracleAdapter();
    const sql =
      'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)';

    expect(adapter.makeSqlBindings(sql, { FROM_DATE: '2024-01-01' })).toEqual({
      sqlString: sql,
      bindings: ['2024-01-01'],
    });
  });

  it('keeps first-occurrence order when repeats are interleaved with other placeholders', (): void => {
    const adapter = createOracleAdapter();
    const sql =
      'SELECT * FROM T WHERE A = :FIRST AND B = :SECOND AND C = :FIRST AND D = :THIRD';

    expect(
      adapter.makeSqlBindings(sql, { first: 1, second: 2, third: 3 })
    ).toEqual({
      sqlString: sql,
      bindings: [1, 2, 3],
    });
  });

  it('binds a repeated placeholder with no supplied value to a single null', (): void => {
    const adapter = createOracleAdapter();
    const sql = 'SELECT :MISSING, :MISSING FROM DUAL';

    expect(adapter.makeSqlBindings(sql, {})).toEqual({
      sqlString: sql,
      bindings: [null],
    });
  });

  it('counts a repeated placeholder once even when it recurs three times', (): void => {
    const adapter = createOracleAdapter();
    const sql = 'SELECT :ID FROM T WHERE A = :ID OR B = :ID';

    expect(adapter.makeSqlBindings(sql, { id: 7 })).toEqual({
      sqlString: sql,
      bindings: [7],
    });
  });

  it('keeps unique placeholders bound in occurrence order', (): void => {
    const adapter = createOracleAdapter();
    const sql = 'select * from users where id = :ID and x = :X';

    expect(adapter.makeSqlBindings(sql, { id: 1 })).toEqual({
      sqlString: sql,
      bindings: [1, null],
    });
  });

  it('ignores repeated placeholders inside string literals and comments', (): void => {
    const adapter = createOracleAdapter();
    const sql =
      "select :ID, ':ID' from dual /* :ID */ -- :ID\nwhere x = :X and y = :ID";

    expect(adapter.makeSqlBindings(sql, { id: 1, x: 2 })).toEqual({
      sqlString: sql,
      bindings: [1, 2],
    });
  });

  it('leaves a lowercase placeholder unbound and untouched', (): void => {
    const adapter = createOracleAdapter();
    const sql = 'select * from users where id = :userId and code = :CODE';

    expect(adapter.makeSqlBindings(sql, { userId: 1, code: 'a' })).toEqual({
      sqlString: sql,
      bindings: ['a'],
    });
  });
});
