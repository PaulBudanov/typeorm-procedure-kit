import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

/**
 * These tests confront `makeSqlBindings` with node-oracledb's own statement
 * parser instead of asserting on its return value in isolation. The parser is
 * the authority on how many bind slots a statement really has, and the two
 * counting rules below are copied from the installed driver:
 *
 * - `lib/thin/statement.js` `_addBind` pushes one `bindInfoList` entry per
 *   placeholder OCCURRENCE for plain SQL, but only per DISTINCT name for
 *   PL/SQL (`if (!this.isPlSql || !this.bindInfoDict.has(name))`).
 * - `lib/thin/statement.js:122` `_parseBindName` uppercases every unquoted
 *   bind name it finds in the SQL text, so `:userId`, `:UserId` and `:USERID`
 *   all declare the one bind `USERID`.
 * - `lib/thin/connection.js` `_getExecuteMessage` requires
 *   `binds.length === bindInfoList.length`, falling back to
 *   `bindInfoDict.size` (the distinct-name count) only when the first bind
 *   carries a `name`, i.e. only for named binds.
 * - `lib/thin/connection.js:1334-1345` `_bind` uppercases the caller's bind
 *   name unless it is double-quoted, rejects a name absent from
 *   `bindInfoDict` (`ERR_INVALID_BIND_NAME`) and otherwise fans the one value
 *   out to EVERY occurrence of that name.
 * - `lib/connection.js:459` turns a bind object into one `{name, values}` entry
 *   per own property, so `binds.length` is the object's key count.
 */

interface IOracleBindInfo {
  bindName: string;
}

interface IOracleStatement {
  _prepare(sql: string): void;
  bindInfoDict: Map<string, Array<IOracleBindInfo>>;
  bindInfoList: Array<IOracleBindInfo>;
  isPlSql: boolean;
}

type TOracleStatementConstructor = new () => IOracleStatement;

const requireFromTest = createRequire(import.meta.url);
const { Statement } = requireFromTest('oracledb/lib/thin/statement.js') as {
  Statement: TOracleStatementConstructor;
};

function parseStatement(sql: string): IOracleStatement {
  const statement = new Statement();
  statement._prepare(sql);
  return statement;
}

type TDriverVerdict =
  | { accepted: true; occurrenceValues: Array<unknown> }
  | { accepted: false; reason: 'invalid-bind-name' | 'wrong-number-of-binds' };

/**
 * Replays node-oracledb's bind validation against a real parsed statement and
 * reports what the driver would do with the given binding shape.
 * @param sql - the statement text handed to the driver.
 * @param bindings - the binding shape `makeSqlBindings` returned.
 * @returns the driver's verdict, with the value each bind slot would receive.
 */
function applyDriverBindRules(
  sql: string,
  bindings: Array<unknown> | Record<string, unknown>
): TDriverVerdict {
  const statement = parseStatement(sql);
  const slotCount = statement.bindInfoList.length;

  if (Array.isArray(bindings)) {
    if (slotCount !== bindings.length)
      return { accepted: false, reason: 'wrong-number-of-binds' };
    return { accepted: true, occurrenceValues: [...bindings] };
  }

  const bindNames = Object.getOwnPropertyNames(bindings);
  if (
    slotCount !== bindNames.length &&
    statement.bindInfoDict.size !== bindNames.length
  )
    return { accepted: false, reason: 'wrong-number-of-binds' };

  const valuesByDeclaredName = new Map<string, unknown>();
  for (const bindName of bindNames) {
    const declaredName =
      bindName.startsWith('"') && bindName.endsWith('"')
        ? bindName.slice(1, -1)
        : bindName.toUpperCase();
    if (!statement.bindInfoDict.has(declaredName))
      return { accepted: false, reason: 'invalid-bind-name' };
    valuesByDeclaredName.set(declaredName, bindings[bindName]);
  }

  return {
    accepted: true,
    occurrenceValues: statement.bindInfoList.map(({ bindName }) =>
      valuesByDeclaredName.get(bindName)
    ),
  };
}

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

interface IBindingCase {
  /** Per-slot values the driver would deliver, in `bindInfoList` order. */
  expectedOccurrenceValues?: Array<unknown>;
  expectedBindings: Record<string, unknown>;
  expectedVerdict: 'accepted' | 'invalid-bind-name' | 'wrong-number-of-binds';
  name: string;
  params: Record<string, unknown>;
  sql: string;
}

const BINDING_CASES: Array<IBindingCase> = [
  {
    name: 'plain SQL, placeholder repeated',
    sql: 'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)',
    params: { FROM_DATE: '2024-01-01' },
    expectedBindings: { FROM_DATE: '2024-01-01' },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: ['2024-01-01', '2024-01-01'],
  },
  {
    name: 'PL/SQL block, placeholder repeated',
    sql: 'BEGIN pkg.report(:FROM_DATE, :FROM_DATE); END;',
    params: { FROM_DATE: '2024-01-01' },
    expectedBindings: { FROM_DATE: '2024-01-01' },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: ['2024-01-01'],
  },
  {
    name: 'plain SQL, unique placeholders',
    sql: 'SELECT * FROM T WHERE A = :FIRST AND B = :SECOND',
    params: { first: 1, second: 2 },
    expectedBindings: { FIRST: 1, SECOND: 2 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1, 2],
  },
  {
    name: 'PL/SQL block, unique placeholders',
    sql: 'BEGIN pkg.report(:FIRST, :SECOND); END;',
    params: { first: 1, second: 2 },
    expectedBindings: { FIRST: 1, SECOND: 2 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1, 2],
  },
  {
    name: 'plain SQL, repeats interleaved with other placeholders',
    sql: 'SELECT * FROM T WHERE A = :FIRST AND B = :SECOND AND C = :FIRST AND D = :THIRD',
    params: { first: 1, second: 2, third: 3 },
    expectedBindings: { FIRST: 1, SECOND: 2, THIRD: 3 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1, 2, 1, 3],
  },
  {
    name: 'repeated placeholder supplied as null binds one null',
    sql: 'SELECT :NOTHING, :NOTHING FROM DUAL',
    params: { NOTHING: null },
    expectedBindings: { NOTHING: null },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [null, null],
  },
  {
    name: 'keys that match no placeholder are ignored',
    sql: 'SELECT * FROM T WHERE A = :FIRST',
    params: { first: 1, unused: 2, alsoUnused: undefined },
    expectedBindings: { FIRST: 1 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1],
  },
  {
    name: 'placeholders inside string literals and comments are not bound',
    sql: "select :ID, ':ID' from dual /* :ID */ -- :ID\nwhere x = :X and y = :ID",
    params: { id: 1, x: 2 },
    expectedBindings: { ID: 1, X: 2 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1, 2, 1],
  },
  {
    name: "placeholders inside an Oracle q'{...}' literal are not bound",
    sql: "select :ID, q'{:ID}' from dual",
    params: { id: 1 },
    expectedBindings: { ID: 1 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1],
  },
  {
    name: 'statement without placeholders binds nothing',
    sql: 'SELECT 1 FROM DUAL',
    params: { unused: 1 },
    expectedBindings: {},
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [],
  },
  {
    name: 'TypeORM array form :...IDS is refused by the driver, never misaligned',
    sql: 'SELECT * FROM docs WHERE tenant_id = :TENANT AND id IN (:...IDS) AND owner = :TENANT',
    params: { tenant: 'attacker', ids: [1, 2] },
    expectedBindings: { TENANT: 'attacker', IDS: [1, 2] },
    expectedVerdict: 'invalid-bind-name',
  },
  {
    name: 'mixed-case :userId binds case-insensitively, like the driver',
    sql: 'select * from users where id = :userId and code = :CODE',
    params: { userId: 1, code: 'a' },
    expectedBindings: { USERID: 1, CODE: 'a' },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1, 'a'],
  },
  {
    name: 'lowercase placeholder binds an uppercase key',
    sql: 'select * from users where code = :code',
    params: { CODE: 'a' },
    expectedBindings: { CODE: 'a' },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: ['a'],
  },
  {
    name: 'plain SQL, one name spelled in different cases fans out to every occurrence',
    sql: 'SELECT * FROM T WHERE A = :userId OR B = :USERID OR C = :UserId',
    params: { UserId: 7 },
    expectedBindings: { USERID: 7 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [7, 7, 7],
  },
  {
    name: 'keys differing only in letter case that no placeholder reads are ignored',
    sql: 'SELECT * FROM T WHERE A = :FIRST',
    params: { first: 1, other: 2, OTHER: 3 },
    expectedBindings: { FIRST: 1 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [1],
  },
  {
    name: 'PL/SQL block, one name spelled in different cases is one slot',
    sql: 'BEGIN pkg.run(:userId, :USERID); END;',
    params: { userid: 7 },
    expectedBindings: { USERID: 7 },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [7],
  },
];

describe('OracleAdapter raw SQL bindings', (): void => {
  it('returns a named bind object rather than a positional array', (): void => {
    const adapter = createOracleAdapter();
    const sql =
      'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)';

    const { bindings, sqlString } = adapter.makeSqlBindings(sql, {
      FROM_DATE: '2024-01-01',
    });

    expect(Array.isArray(bindings)).toBe(false);
    expect(bindings).toEqual({ FROM_DATE: '2024-01-01' });
    expect(sqlString).toBe(sql);
  });

  describe.each(BINDING_CASES)(
    '$name',
    ({
      expectedBindings,
      expectedOccurrenceValues,
      expectedVerdict,
      params,
      sql,
    }): void => {
      it('produces the expected binding shape', (): void => {
        const adapter = createOracleAdapter();

        const result = adapter.makeSqlBindings(sql, params);

        expect(result.sqlString).toBe(sql);
        expect(result.bindings).toEqual(expectedBindings);
      });

      it("satisfies node-oracledb's own bind rules", (): void => {
        const adapter = createOracleAdapter();

        const verdict = applyDriverBindRules(
          sql,
          adapter.makeSqlBindings(sql, params).bindings
        );

        if (expectedVerdict === 'accepted') {
          expect(verdict).toEqual({
            accepted: true,
            occurrenceValues: expectedOccurrenceValues,
          });
          return;
        }
        expect(verdict).toEqual({ accepted: false, reason: expectedVerdict });
      });
    }
  );

  it('rejects the positional form for a repeated placeholder in plain SQL with one value per distinct name', (): void => {
    const sql =
      'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)';

    // Plain SQL has one bind slot per OCCURRENCE, so a positional list with one
    // value per DISTINCT name gives the driver 2 slots and 1 value.
    expect(applyDriverBindRules(sql, ['2024-01-01'])).toEqual({
      accepted: false,
      reason: 'wrong-number-of-binds',
    });
  });

  it('rejects the positional form for a repeated placeholder in PL/SQL with one value per occurrence', (): void => {
    const sql = 'BEGIN pkg.report(:FROM_DATE, :FROM_DATE); END;';

    // PL/SQL collapses repeats to a single slot, so a positional list with one
    // value per OCCURRENCE gives the driver 1 slot and 2 values.
    expect(applyDriverBindRules(sql, ['2024-01-01', '2024-01-01'])).toEqual({
      accepted: false,
      reason: 'wrong-number-of-binds',
    });
  });

  it('cannot route a value onto a different placeholder than its own name', (): void => {
    const adapter = createOracleAdapter();
    const sql =
      'SELECT * FROM docs WHERE tenant_id = :TENANT AND id IN (:...IDS) AND owner = :TENANT';
    const statement = parseStatement(sql);

    const { bindings } = adapter.makeSqlBindings(sql, {
      tenant: 'attacker',
      ids: [1, 2],
    });

    // Oracle emits no bind for the TypeORM `:...IDS` form, so both slots belong
    // to TENANT and neither can receive the IDS value.
    expect(statement.bindInfoList.map(({ bindName }) => bindName)).toEqual([
      'TENANT',
      'TENANT',
    ]);
    expect(Object.getOwnPropertyNames(bindings)).toContain('IDS');
    expect(statement.bindInfoDict.has('IDS')).toBe(false);
  });
});

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('OracleAdapter raw SQL placeholders without a value', (): void => {
  it('throws for a mistyped key instead of binding NULL', (): void => {
    const adapter = createOracleAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('SELECT * FROM USERS WHERE ID = :USER_ID', {
        USERID: 42,
      })
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :USER_ID has no value in params; supplied keys: "USERID"'
    );
  });

  it('is the only guard: the driver itself runs a mistyped key with NULL', (): void => {
    // The shape the kit used to hand the driver for `{ USERID: 42 }`: the
    // statement declares USER_ID, receives USER_ID, and runs with NULL.
    expect(
      applyDriverBindRules('SELECT * FROM USERS WHERE ID = :USER_ID', {
        USER_ID: null,
      })
    ).toEqual({ accepted: true, occurrenceValues: [null] });
  });

  it('names the placeholder as written in the SQL', (): void => {
    const adapter = createOracleAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('select :userId from dual', { user_id: 1 })
    );

    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :userId has no value in params; supplied keys: "user_id"'
    );
  });

  it('throws when params are omitted altogether', (): void => {
    const adapter = createOracleAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('SELECT :ID FROM DUAL')
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :ID has no value in params; supplied keys: none'
    );
  });

  it('still throws for a placeholder no key names, listing keys set to undefined as supplied', (): void => {
    const adapter = createOracleAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('SELECT :missing FROM DUAL', {
        id: undefined,
        status: null,
      })
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :missing has no value in params; supplied keys: "id", "status"'
    );
  });

  it('does not read a value inherited from the prototype', (): void => {
    const adapter = createOracleAdapter();
    const params = Object.create({ ID: 1 }) as Record<string, unknown>;

    expect((): void => {
      adapter.makeSqlBindings('SELECT :ID FROM DUAL', params);
    }).toThrow('Raw SQL placeholder :ID has no value in params');
  });

  it('checks every placeholder, not only the first one', (): void => {
    const adapter = createOracleAdapter();

    expect((): void => {
      adapter.makeSqlBindings('SELECT :A, :B FROM DUAL', { A: 1 });
    }).toThrow('Raw SQL placeholder :B has no value in params');
  });

  it('names the TypeORM array form as written', (): void => {
    const adapter = createOracleAdapter();

    expect((): void => {
      adapter.makeSqlBindings('SELECT * FROM T WHERE ID IN (:...IDS)', {});
    }).toThrow('Raw SQL placeholder :...IDS has no value in params');
  });

  it('needs no value for placeholders inside literals and comments', (): void => {
    const adapter = createOracleAdapter();
    const sql = "select ':ID', q'[:ID]' from dual /* :ID */ -- :ID\n";

    expect(adapter.makeSqlBindings(sql)).toEqual({
      bindings: {},
      sqlString: sql,
    });
  });

  it('lists at most twenty supplied keys', (): void => {
    const adapter = createOracleAdapter();
    const params = Object.fromEntries(
      Array.from({ length: 25 }, (_unused, index) => [`K${index}`, index])
    );

    const error = captureError(() =>
      adapter.makeSqlBindings('SELECT :MISSING FROM DUAL', params)
    );

    expect((error as ServerError).message).toBe(
      `Raw SQL placeholder :MISSING has no value in params; supplied keys: ${Array.from(
        { length: 20 },
        (_unused, index) => `"K${index}"`
      ).join(', ')} and 5 more`
    );
  });
});

describe('OracleAdapter raw SQL keys that differ only in letter case', (): void => {
  it('throws for a placeholder two supplied keys would bind, naming both keys and no value', (): void => {
    const adapter = createOracleAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('SELECT * FROM T WHERE A = :ID', {
        id: 'first-secret',
        ID: 'second-secret',
      })
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :ID has more than one value in params; supplied keys that differ only in letter case: "id", "ID"'
    );
    expect((error as ServerError).message).not.toContain('secret');
  });

  it('counts a key set to null as supplied, so it conflicts too', (): void => {
    const adapter = createOracleAdapter();

    expect((): void => {
      adapter.makeSqlBindings('SELECT * FROM T WHERE A = :ID', {
        id: null,
        ID: 2,
      });
    }).toThrow(
      'Raw SQL placeholder :ID has more than one value in params; supplied keys that differ only in letter case: "id", "ID"'
    );
  });

  it('lists every key of a three-way collision', (): void => {
    const adapter = createOracleAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('SELECT * FROM T WHERE A = :ID', {
        id: 1,
        ID: 2,
        Id: 3,
      })
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :ID has more than one value in params; supplied keys that differ only in letter case: "id", "ID", "Id"'
    );
  });

  it('reports a placeholder used twice once, as written at its first occurrence', (): void => {
    const adapter = createOracleAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('SELECT * FROM T WHERE A = :id OR B = :ID', {
        id: 1,
        ID: 2,
      })
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :id has more than one value in params; supplied keys that differ only in letter case: "id", "ID"'
    );
  });
});

interface IUndefinedBindingCase {
  expectedBindings: Record<string, unknown>;
  /** Per-slot values the driver would deliver, in `bindInfoList` order. */
  expectedOccurrenceValues: Array<unknown>;
  name: string;
  params: Record<string, unknown>;
  sql: string;
}

/** Filter fields every query sets; spread with an optional one left unset. */
const REQUIRED_FILTER = { id: 1 };

const UNDEFINED_BINDING_CASES: Array<IUndefinedBindingCase> = [
  {
    name: 'a key set to undefined binds NULL',
    sql: 'SELECT * FROM T WHERE A = :id',
    params: { id: undefined },
    expectedBindings: { ID: null },
    expectedOccurrenceValues: [null],
  },
  {
    name: 'a repeated placeholder whose key is undefined binds NULL to every occurrence',
    sql: 'SELECT * FROM ORDERS WHERE (:fromDate IS NULL OR ORDER_DATE >= :fromDate)',
    params: { fromDate: undefined },
    expectedBindings: { FROMDATE: null },
    expectedOccurrenceValues: [null, null],
  },
  {
    name: 'keys differing only in letter case, both undefined, bind NULL without a conflict',
    sql: 'SELECT * FROM T WHERE A = :id',
    params: { id: undefined, ID: undefined },
    expectedBindings: { ID: null },
    expectedOccurrenceValues: [null],
  },
  {
    name: 'a key set to undefined takes no part in a letter-case conflict with null',
    sql: 'SELECT * FROM T WHERE A = :id',
    params: { id: null, ID: undefined },
    expectedBindings: { ID: null },
    expectedOccurrenceValues: [null],
  },
  {
    name: 'a key set to undefined takes no part in a letter-case conflict with a value',
    sql: 'SELECT * FROM T WHERE A = :ID',
    params: { id: undefined, ID: 2 },
    expectedBindings: { ID: 2 },
    expectedOccurrenceValues: [2],
  },
  {
    name: 'a spread object with an unset optional property binds NULL for it',
    sql: 'SELECT * FROM T WHERE ID = :id AND STATUS = :status',
    params: { ...REQUIRED_FILTER, status: undefined },
    expectedBindings: { ID: 1, STATUS: null },
    expectedOccurrenceValues: [1, null],
  },
];

describe('OracleAdapter raw SQL keys set to undefined', (): void => {
  describe.each(UNDEFINED_BINDING_CASES)(
    '$name',
    ({ expectedBindings, expectedOccurrenceValues, params, sql }): void => {
      it('produces the expected binding values, never undefined', (): void => {
        const adapter = createOracleAdapter();

        expect(adapter.makeSqlBindings(sql, params)).toStrictEqual({
          bindings: expectedBindings,
          sqlString: sql,
        });
      });

      it("satisfies node-oracledb's own bind rules with no undefined value", (): void => {
        const adapter = createOracleAdapter();

        const verdict = applyDriverBindRules(
          sql,
          adapter.makeSqlBindings(sql, params).bindings
        );

        expect(verdict).toStrictEqual({
          accepted: true,
          occurrenceValues: expectedOccurrenceValues,
        });
      });
    }
  );
});
