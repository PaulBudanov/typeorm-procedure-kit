import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
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
 * - `lib/thin/connection.js` `_getExecuteMessage` requires
 *   `binds.length === bindInfoList.length`, falling back to
 *   `bindInfoDict.size` (the distinct-name count) only when the first bind
 *   carries a `name`, i.e. only for named binds.
 * - `lib/thin/connection.js` `_bind` rejects a named bind whose name is absent
 *   from `bindInfoDict` (`ERR_INVALID_BIND_NAME`) and otherwise fans the one
 *   value out to EVERY occurrence of that name.
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

  for (const bindName of bindNames) {
    if (!statement.bindInfoDict.has(bindName.toUpperCase()))
      return { accepted: false, reason: 'invalid-bind-name' };
  }

  return {
    accepted: true,
    occurrenceValues: statement.bindInfoList.map(
      ({ bindName }) => bindings[bindName]
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
    name: 'plain SQL, placeholder repeated (the abf95f2 headline query)',
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
    name: 'repeated placeholder with no supplied value binds one null',
    sql: 'SELECT :MISSING, :MISSING FROM DUAL',
    params: {},
    expectedBindings: { MISSING: null },
    expectedVerdict: 'accepted',
    expectedOccurrenceValues: [null, null],
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
    name: 'lowercase :userId is not recognised, so the driver refuses the call',
    sql: 'select * from users where id = :userId and code = :CODE',
    params: { userId: 1, code: 'a' },
    expectedBindings: { CODE: 'a' },
    expectedVerdict: 'wrong-number-of-binds',
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

  it('rejects the positional shape abf95f2 produced for repeated placeholders', (): void => {
    const sql =
      'SELECT * FROM ORDERS WHERE (:FROM_DATE IS NULL OR ORDER_DATE >= :FROM_DATE)';

    // abf95f2 emitted one positional value per DISTINCT name. Plain SQL has one
    // bind slot per OCCURRENCE, so the driver saw 2 slots and 1 value.
    expect(applyDriverBindRules(sql, ['2024-01-01'])).toEqual({
      accepted: false,
      reason: 'wrong-number-of-binds',
    });
  });

  it('rejects the positional shape the pre-abf95f2 code produced for PL/SQL', (): void => {
    const sql = 'BEGIN pkg.report(:FROM_DATE, :FROM_DATE); END;';

    // Before abf95f2 one value per OCCURRENCE was emitted. PL/SQL collapses
    // repeats to a single slot, so the driver saw 1 slot and 2 values.
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
