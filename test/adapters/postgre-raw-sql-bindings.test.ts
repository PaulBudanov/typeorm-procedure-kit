import { describe, expect, it } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

/**
 * These tests confront `makeSqlBindings` with what PostgreSQL does with the
 * statement it receives, instead of asserting on the return value alone.
 * node-postgres does not parse SQL, so the authority is the server; its rules
 * are replayed below.
 *
 * What node-postgres does (installed source):
 * - `pg/lib/query.js:160-161` refuses values that are not an array.
 * - `pg/lib/query.js:53-57` uses the extended protocol (Parse + Bind) only
 *   when `values.length > 0`; otherwise the text goes out as a simple query.
 * - `pg-protocol/dist/serializer.js:93-95` writes `values.length` as the Bind
 *   message's parameter count, one value per `$n` slot.
 *
 * What the server does (PostgreSQL source, not installed here):
 * - the lexer (`scan.l`, `param \${decinteger}`) reads `$n` as a parameter
 *   reference outside string literals, quoted identifiers and comments; a
 *   `:name` left in the text is a syntax error outside an array subscript;
 * - `exec_parse_message` grows the parameter count to the highest `$n` and
 *   fails with "could not determine data type of parameter $k" for a `$k`
 *   that is never referenced;
 * - `exec_bind_message` fails with "bind message supplies X parameters, but
 *   prepared statement requires Y" when the counts differ;
 * - a simple query has no parameters: "there is no parameter $n".
 *
 * The replay does not model type inference or array subscripts.
 */

type TPostgresVerdict =
  | { accepted: true; occurrenceValues: Array<unknown> }
  | {
      accepted: false;
      reason:
        | 'named-placeholder-left'
        | 'no-parameter'
        | 'undetermined-parameter'
        | 'values-not-array'
        | 'wrong-number-of-parameters';
    };

function isIdentifierCharacter(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}

function skipQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote && sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    if (sql[index] === quote) return index + 1;
    index += 1;
  }
  return sql.length;
}

function skipEscapeString(sql: string, quoteStart: number): number {
  let index = quoteStart + 1;
  while (index < sql.length) {
    if (sql[index] === '\\') {
      index += 2;
      continue;
    }
    if (sql[index] === "'" && sql[index + 1] === "'") {
      index += 2;
      continue;
    }
    if (sql[index] === "'") return index + 1;
    index += 1;
  }
  return sql.length;
}

function skipBlockComment(sql: string, start: number): number {
  let index = start + 2;
  let depth = 1;
  while (index < sql.length && depth > 0) {
    if (sql.startsWith('/*', index)) {
      depth += 1;
      index += 2;
    } else if (sql.startsWith('*/', index)) {
      depth -= 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  return index;
}

/**
 * Lexes the statement the way the server does for the purpose of parameters:
 * collects every `$n` reference in order and every `:name` left in the text.
 */
function scanPostgresStatement(sql: string): {
  leftoverNamedPlaceholders: Array<string>;
  parameterReferences: Array<number>;
} {
  const leftoverNamedPlaceholders: Array<string> = [];
  const parameterReferences: Array<number> = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    const previous = sql[index - 1];
    if (
      (char === 'E' || char === 'e') &&
      next === "'" &&
      !isIdentifierCharacter(previous)
    ) {
      index = skipEscapeString(sql, index + 1);
    } else if (char === "'" || char === '"') {
      index = skipQuoted(sql, index, char);
    } else if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline;
    } else if (char === '/' && next === '*') {
      index = skipBlockComment(sql, index);
    } else if (char === '$' && !isIdentifierCharacter(previous)) {
      const parameter = /^\$(\d+)/.exec(sql.slice(index));
      const dollarTag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(
        sql.slice(index)
      );
      if (parameter) {
        parameterReferences.push(Number(parameter[1]));
        index += parameter[0].length;
      } else if (dollarTag) {
        const end = sql.indexOf(dollarTag[0], index + dollarTag[0].length);
        index = end === -1 ? sql.length : end + dollarTag[0].length;
      } else {
        index += 1;
      }
    } else if (char === ':' && next === ':') {
      index += 2;
    } else if (char === ':' && next !== undefined && /[A-Za-z_]/.test(next)) {
      const name = /^:[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(index))?.[0];
      leftoverNamedPlaceholders.push(name ?? ':');
      index += (name ?? ':').length;
    } else {
      index += 1;
    }
  }
  return { leftoverNamedPlaceholders, parameterReferences };
}

/**
 * Replays node-postgres and the PostgreSQL server against the statement and
 * values `makeSqlBindings` returned.
 * @param sql - the statement text handed to the driver.
 * @param bindings - the binding shape `makeSqlBindings` returned.
 * @returns the verdict, with the value each `$n` occurrence would receive.
 */
function applyPostgresBindRules(
  sql: string,
  bindings: Array<unknown> | Record<string, unknown>
): TPostgresVerdict {
  if (!Array.isArray(bindings))
    return { accepted: false, reason: 'values-not-array' };
  const { leftoverNamedPlaceholders, parameterReferences } =
    scanPostgresStatement(sql);
  if (leftoverNamedPlaceholders.length > 0)
    return { accepted: false, reason: 'named-placeholder-left' };
  if (bindings.length === 0) {
    if (parameterReferences.length > 0)
      return { accepted: false, reason: 'no-parameter' };
    return { accepted: true, occurrenceValues: [] };
  }
  const parameterCount = Math.max(0, ...parameterReferences);
  for (let position = 1; position <= parameterCount; position += 1) {
    if (!parameterReferences.includes(position))
      return { accepted: false, reason: 'undetermined-parameter' };
  }
  if (bindings.length !== parameterCount)
    return { accepted: false, reason: 'wrong-number-of-parameters' };
  return {
    accepted: true,
    occurrenceValues: parameterReferences.map(
      (position) => bindings[position - 1]
    ),
  };
}

function createPostgreAdapter(): PostgreAdapter {
  return new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
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

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

interface IBindingCase {
  expectedBindings: Array<unknown>;
  /** Per-occurrence values the server would deliver, in `$n` order of appearance. */
  expectedOccurrenceValues: Array<unknown>;
  expectedSql: string;
  name: string;
  params: Record<string, unknown>;
  sql: string;
}

const BINDING_CASES: Array<IBindingCase> = [
  {
    name: 'unique uppercase placeholders',
    sql: 'select * from users where id = :ID and x = :X',
    params: { id: 1, x: 2 },
    expectedSql: 'select * from users where id = $1 and x = $2',
    expectedBindings: [1, 2],
    expectedOccurrenceValues: [1, 2],
  },
  {
    name: 'repeated placeholder takes one slot per occurrence',
    sql: 'SELECT * FROM ORDERS WHERE (:FROM_DATE::date IS NULL OR ORDER_DATE >= :FROM_DATE)',
    params: { FROM_DATE: '2024-01-01' },
    expectedSql:
      'SELECT * FROM ORDERS WHERE ($1::date IS NULL OR ORDER_DATE >= $2)',
    expectedBindings: ['2024-01-01', '2024-01-01'],
    expectedOccurrenceValues: ['2024-01-01', '2024-01-01'],
  },
  {
    name: 'a cast after the placeholder is kept',
    sql: 'select :ID::uuid',
    params: { ID: '550e8400-e29b-41d4-a716-446655440000' },
    expectedSql: 'select $1::uuid',
    expectedBindings: ['550e8400-e29b-41d4-a716-446655440000'],
    expectedOccurrenceValues: ['550e8400-e29b-41d4-a716-446655440000'],
  },
  {
    name: 'placeholders inside literals, quoted identifiers, dollar quotes and comments are not bound',
    sql: "select :ID, ':ID', E'it\\'s :ID', \"x:ID\", $$ :ID $$, $fn$ :ID $fn$ /* a /* :ID */ :ID */ -- :ID\nwhere x = :X",
    params: { id: 1, x: 2 },
    expectedSql:
      "select $1, ':ID', E'it\\'s :ID', \"x:ID\", $$ :ID $$, $fn$ :ID $fn$ /* a /* :ID */ :ID */ -- :ID\nwhere x = $2",
    expectedBindings: [1, 2],
    expectedOccurrenceValues: [1, 2],
  },
  {
    name: 'placeholder supplied as null binds null',
    sql: 'select :NOTHING::int, :NOTHING::int',
    params: { NOTHING: null },
    expectedSql: 'select $1::int, $2::int',
    expectedBindings: [null, null],
    expectedOccurrenceValues: [null, null],
  },
  {
    name: 'keys that match no placeholder are ignored',
    sql: 'select :FIRST::int',
    params: { first: 1, unused: 2, alsoUnused: undefined },
    expectedSql: 'select $1::int',
    expectedBindings: [1],
    expectedOccurrenceValues: [1],
  },
  {
    name: 'statement without placeholders binds nothing',
    sql: 'select 1',
    params: { unused: 1 },
    expectedSql: 'select 1',
    expectedBindings: [],
    expectedOccurrenceValues: [],
  },
  {
    name: 'a numeric array slice bound is not a placeholder',
    sql: 'select tags[1:2] from t',
    params: {},
    expectedSql: 'select tags[1:2] from t',
    expectedBindings: [],
    expectedOccurrenceValues: [],
  },
  {
    name: 'mixed-case :userId binds case-insensitively, like Oracle',
    sql: 'select * from users where id = :userId and code = :CODE',
    params: { userId: 1, code: 'a' },
    expectedSql: 'select * from users where id = $1 and code = $2',
    expectedBindings: [1, 'a'],
    expectedOccurrenceValues: [1, 'a'],
  },
  {
    name: 'lowercase placeholder binds an uppercase key',
    sql: 'select * from users where code = :code',
    params: { CODE: 'a' },
    expectedSql: 'select * from users where code = $1',
    expectedBindings: ['a'],
    expectedOccurrenceValues: ['a'],
  },
  {
    name: 'one name spelled in different cases binds the same value to every occurrence',
    sql: 'select * from t where a = :userId or b = :USERID or c = :UserId',
    params: { UserId: 7 },
    expectedSql: 'select * from t where a = $1 or b = $2 or c = $3',
    expectedBindings: [7, 7, 7],
    expectedOccurrenceValues: [7, 7, 7],
  },
  {
    name: 'keys differing only in letter case that no placeholder reads are ignored',
    sql: 'select :FIRST::int',
    params: { first: 1, other: 2, OTHER: 3 },
    expectedSql: 'select $1::int',
    expectedBindings: [1],
    expectedOccurrenceValues: [1],
  },
];

describe('PostgreAdapter raw SQL bindings', (): void => {
  describe.each(BINDING_CASES)(
    '$name',
    ({
      expectedBindings,
      expectedOccurrenceValues,
      expectedSql,
      params,
      sql,
    }): void => {
      it('produces the expected SQL and binding values', (): void => {
        const adapter = createPostgreAdapter();

        expect(adapter.makeSqlBindings(sql, params)).toEqual({
          bindings: expectedBindings,
          sqlString: expectedSql,
        });
      });

      it('is accepted by node-postgres and the PostgreSQL server rules', (): void => {
        const adapter = createPostgreAdapter();
        const { bindings, sqlString } = adapter.makeSqlBindings(sql, params);

        expect(applyPostgresBindRules(sqlString, bindings)).toEqual({
          accepted: true,
          occurrenceValues: expectedOccurrenceValues,
        });
      });
    }
  );

  it('the replay refuses a :name left in the text, as the server does', (): void => {
    expect(
      applyPostgresBindRules('select * from users where id = :userId', [])
    ).toEqual({ accepted: false, reason: 'named-placeholder-left' });
  });

  it('the replay refuses a value count that differs from the $n count', (): void => {
    expect(applyPostgresBindRules('select $1, $2', [1])).toEqual({
      accepted: false,
      reason: 'wrong-number-of-parameters',
    });
  });
});

describe('PostgreAdapter raw SQL placeholders without a value', (): void => {
  it('throws for a mistyped key instead of binding NULL', (): void => {
    const adapter = createPostgreAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('select * from users where id = :USER_ID', {
        USERID: 42,
      })
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :USER_ID has no value in params; supplied keys: "USERID"'
    );
  });

  it('is the only guard: the server itself runs a mistyped key with NULL', (): void => {
    // The shape the adapter used to hand the driver for `{ USERID: 42 }`.
    expect(
      applyPostgresBindRules('select * from users where id = $1', [null])
    ).toEqual({ accepted: true, occurrenceValues: [null] });
  });

  it('throws when params are omitted altogether', (): void => {
    const adapter = createPostgreAdapter();

    const error = captureError(() => adapter.makeSqlBindings('select :ID'));

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :ID has no value in params; supplied keys: none'
    );
  });

  it('still throws for a placeholder no key names, listing keys set to undefined as supplied', (): void => {
    const adapter = createPostgreAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('select :missing', {
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
    const adapter = createPostgreAdapter();
    const params = Object.create({ ID: 1 }) as Record<string, unknown>;

    expect((): void => {
      adapter.makeSqlBindings('select :ID', params);
    }).toThrow('Raw SQL placeholder :ID has no value in params');
  });

  it('checks every placeholder, not only the first one', (): void => {
    const adapter = createPostgreAdapter();

    expect((): void => {
      adapter.makeSqlBindings('select :A::int, :B::int', { A: 1 });
    }).toThrow('Raw SQL placeholder :B has no value in params');
  });

  it('needs no value for placeholders inside literals and comments', (): void => {
    const adapter = createPostgreAdapter();
    const sql = "select ':ID', $$ :ID $$ /* :ID */ -- :ID\n";

    expect(adapter.makeSqlBindings(sql)).toEqual({
      bindings: [],
      sqlString: sql,
    });
  });

  it('reads an identifier array slice bound as a placeholder; a space keeps it SQL', (): void => {
    const adapter = createPostgreAdapter();

    expect((): void => {
      adapter.makeSqlBindings('select tags[1:n] from t', {});
    }).toThrow('Raw SQL placeholder :n has no value in params');
    expect(adapter.makeSqlBindings('select tags[1: n] from t', {})).toEqual({
      bindings: [],
      sqlString: 'select tags[1: n] from t',
    });
  });
});

describe('PostgreAdapter raw SQL keys that differ only in letter case', (): void => {
  it('throws for a placeholder two supplied keys would bind, naming both keys and no value', (): void => {
    const adapter = createPostgreAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('select * from t where a = :ID', {
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
    const adapter = createPostgreAdapter();

    expect((): void => {
      adapter.makeSqlBindings('select * from t where a = :ID::int', {
        id: null,
        ID: 2,
      });
    }).toThrow(
      'Raw SQL placeholder :ID has more than one value in params; supplied keys that differ only in letter case: "id", "ID"'
    );
  });

  it('lists every key of a three-way collision', (): void => {
    const adapter = createPostgreAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings('select * from t where a = :ID::int', {
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
    const adapter = createPostgreAdapter();

    const error = captureError(() =>
      adapter.makeSqlBindings(
        'select * from t where a = :id::int or b = :ID::int',
        { id: 1, ID: 2 }
      )
    );

    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).message).toBe(
      'Raw SQL placeholder :id has more than one value in params; supplied keys that differ only in letter case: "id", "ID"'
    );
  });
});

/** Filter fields every query sets; spread with an optional one left unset. */
const REQUIRED_FILTER = { id: 1 };

const UNDEFINED_BINDING_CASES: Array<IBindingCase> = [
  {
    name: 'a key set to undefined binds NULL',
    sql: 'select * from t where a = :id::int',
    params: { id: undefined },
    expectedSql: 'select * from t where a = $1::int',
    expectedBindings: [null],
    expectedOccurrenceValues: [null],
  },
  {
    name: 'a repeated placeholder whose key is undefined binds NULL to every occurrence',
    sql: 'select * from orders where (:fromDate::date is null or order_date >= :fromDate)',
    params: { fromDate: undefined },
    expectedSql:
      'select * from orders where ($1::date is null or order_date >= $2)',
    expectedBindings: [null, null],
    expectedOccurrenceValues: [null, null],
  },
  {
    name: 'keys differing only in letter case, both undefined, bind NULL without a conflict',
    sql: 'select * from t where a = :id::int',
    params: { id: undefined, ID: undefined },
    expectedSql: 'select * from t where a = $1::int',
    expectedBindings: [null],
    expectedOccurrenceValues: [null],
  },
  {
    name: 'a key set to undefined takes no part in a letter-case conflict with null',
    sql: 'select * from t where a = :id::int',
    params: { id: null, ID: undefined },
    expectedSql: 'select * from t where a = $1::int',
    expectedBindings: [null],
    expectedOccurrenceValues: [null],
  },
  {
    name: 'a key set to undefined takes no part in a letter-case conflict with a value',
    sql: 'select * from t where a = :ID::int',
    params: { id: undefined, ID: 2 },
    expectedSql: 'select * from t where a = $1::int',
    expectedBindings: [2],
    expectedOccurrenceValues: [2],
  },
  {
    name: 'a spread object with an unset optional property binds NULL for it',
    sql: 'select * from t where id = :id::int and status = :status',
    params: { ...REQUIRED_FILTER, status: undefined },
    expectedSql: 'select * from t where id = $1::int and status = $2',
    expectedBindings: [1, null],
    expectedOccurrenceValues: [1, null],
  },
];

describe('PostgreAdapter raw SQL keys set to undefined', (): void => {
  describe.each(UNDEFINED_BINDING_CASES)(
    '$name',
    ({
      expectedBindings,
      expectedOccurrenceValues,
      expectedSql,
      params,
      sql,
    }): void => {
      it('produces the expected binding values, never undefined', (): void => {
        const adapter = createPostgreAdapter();

        expect(adapter.makeSqlBindings(sql, params)).toStrictEqual({
          bindings: expectedBindings,
          sqlString: expectedSql,
        });
      });

      it('is accepted by node-postgres and the PostgreSQL server rules with no undefined value', (): void => {
        const adapter = createPostgreAdapter();
        const { bindings, sqlString } = adapter.makeSqlBindings(sql, params);

        expect(applyPostgresBindRules(sqlString, bindings)).toStrictEqual({
          accepted: true,
          occurrenceValues: expectedOccurrenceValues,
        });
      });
    }
  );
});
