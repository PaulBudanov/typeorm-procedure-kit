import { types as pgTypes } from 'pg';
import { describe, expect, it } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

import type {
  IProcedureStructuredType,
  TProcedureArgumentList,
  TProcedurePayload,
} from '../../src/types/procedure.types.js';
import type { IBindingsObjectReturn } from '../../src/types/utility.types.js';

/**
 * How a named payload is resolved to one procedure argument, driven through
 * `PostgreAdapter.makeBindings` with real procedure metadata. The same cases,
 * under the same names, run against Oracle in `oracle-payload-reader.test.ts`,
 * so the two vendors can be compared case by case.
 */

const profileCompositeType = {
  kind: 'postgres-composite',
  schema: 'pkg',
  typeName: 'profile_type',
  typeOid: 16_384,
  fields: [
    {
      name: 'first_name',
      argumentType: 'text',
      order: 1,
      typeOid: pgTypes.builtins.TEXT,
    },
    {
      name: 'score',
      argumentType: 'int4',
      order: 2,
      typeOid: pgTypes.builtins.INT4,
    },
  ],
} satisfies IProcedureStructuredType;

const procedures = {
  scalar: [
    { argumentName: 'p_flag', argumentType: 'int4', order: 1, mode: 'IN' },
  ],
  structured: [
    {
      argumentName: 'p_profile',
      argumentType: 'pkg.profile_type',
      order: 1,
      mode: 'IN',
      structuredType: profileCompositeType,
    },
  ],
  cursor: [
    {
      argumentName: 'p_cursor',
      argumentType: 'refcursor',
      order: 1,
      mode: 'IN/OUT',
    },
  ],
  unprefixed: [
    { argumentName: 'flag', argumentType: 'int4', order: 1, mode: 'IN' },
  ],
  constructor_name: [
    {
      argumentName: 'constructor',
      argumentType: 'int4',
      order: 1,
      mode: 'IN',
    },
  ],
  constructor_alias: [
    {
      argumentName: 'p_constructor',
      argumentType: 'int4',
      order: 1,
      mode: 'IN',
    },
  ],
  proto_alias: [
    {
      argumentName: 'p___proto__',
      argumentType: 'int4',
      order: 1,
      mode: 'IN',
    },
  ],
  positional: [
    { argumentName: 'p_flag', argumentType: 'int4', order: 1, mode: 'IN' },
    {
      argumentName: 'p_profile',
      argumentType: 'pkg.profile_type',
      order: 2,
      mode: 'IN',
      structuredType: profileCompositeType,
    },
    { argumentName: 'p_note', argumentType: 'text', order: 3, mode: 'IN' },
  ],
} satisfies TProcedureArgumentList;

const PROFILE = { first_name: 'Ada', score: 36 };
const OTHER_PROFILE = { first_name: 'Grace', score: 85 };
/** `PROFILE` as the JSON document handed to `jsonb_populate_record`. */
const BOUND_PROFILE = { first_name: 'Ada', score: 36 };

function createPostgreAdapter(): PostgreAdapter {
  return new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: { transformColumnName: (value: string): string => value },
    }
  );
}

function bind(
  processName: keyof typeof procedures,
  payload: TProcedurePayload | null | undefined
): IBindingsObjectReturn {
  return createPostgreAdapter().makeBindings(
    'pkg',
    processName,
    procedures,
    payload
  );
}

/**
 * The value PostgreSQL receives for one argument. Every argument used here is
 * IN or IN/OUT, so each consumes exactly one positional binding and the
 * argument's position is its binding's position; a composite binding is the
 * JSON text handed to `jsonb_populate_record`, parsed back for comparison.
 */
function boundValue(
  processName: keyof typeof procedures,
  payload: TProcedurePayload | null | undefined,
  argumentName: string
): unknown {
  const { bindings } = bind(processName, payload);
  if (!Array.isArray(bindings))
    throw new Error('Expected positional PostgreSQL binds');
  const argumentList: TProcedureArgumentList[Lowercase<string>] =
    procedures[processName];
  const position = argumentList.findIndex(
    (argument) => argument.argumentName === argumentName
  );
  if (position < 0) throw new Error(`Unknown argument "${argumentName}"`);
  const value: unknown = bindings[position];
  const isComposite = argumentList[position]?.structuredType !== undefined;
  return isComposite && typeof value === 'string'
    ? (JSON.parse(value) as unknown)
    : value;
}

function expectConflict(
  processName: keyof typeof procedures,
  payload: TProcedurePayload,
  aliasName: string,
  argumentName: string
): void {
  let thrown: unknown;
  try {
    bind(processName, payload);
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ServerError);
  expect((thrown as Error).message).toBe(
    `Conflicting PostgreSQL procedure payload keys: "${aliasName}" and "${argumentName}"`
  );
}

function nullPrototypePayload(values: Record<string, unknown>): object {
  return Object.assign(Object.create(null) as object, values);
}

describe('PostgreSQL procedure payload reader', (): void => {
  describe('alias conflict', (): void => {
    it('rejects a scalar argument supplied under both its name and its p_-stripped alias', (): void => {
      expectConflict('scalar', { flag: 1, p_flag: 2 }, 'flag', 'p_flag');
    });

    it('rejects a structured argument supplied under both its name and its p_-stripped alias', (): void => {
      expectConflict(
        'structured',
        { profile: PROFILE, p_profile: OTHER_PROFILE },
        'profile',
        'p_profile'
      );
    });

    // PostgreSQL-only: Oracle binds a REF CURSOR without reading the payload,
    // so this call site has no Oracle counterpart.
    it('rejects a refcursor argument supplied under both its name and its p_-stripped alias', (): void => {
      expectConflict(
        'cursor',
        { cursor: 'portal_a', p_cursor: 'portal_b' },
        'cursor',
        'p_cursor'
      );
    });

    it('does not treat an unprefixed argument name as an alias of itself', (): void => {
      expect(boundValue('unprefixed', { flag: 7 }, 'flag')).toBe(7);
    });
  });

  describe('explicit null and undefined', (): void => {
    it('binds an explicit null supplied under the alias of a scalar argument', (): void => {
      expect(boundValue('scalar', { flag: null }, 'p_flag')).toBeNull();
    });

    it('binds an explicit null supplied under the alias of a structured argument', (): void => {
      expect(
        boundValue('structured', { profile: null }, 'p_profile')
      ).toBeNull();
    });

    it('binds an explicit null supplied under the name of a scalar argument', (): void => {
      expect(boundValue('scalar', { p_flag: null }, 'p_flag')).toBeNull();
    });

    it('binds an explicit null supplied under the name of a structured argument', (): void => {
      expect(
        boundValue('structured', { p_profile: null }, 'p_profile')
      ).toBeNull();
    });

    it('rejects an explicit null alias next to a value under the scalar argument name', (): void => {
      expectConflict('scalar', { flag: null, p_flag: 5 }, 'flag', 'p_flag');
    });

    it('rejects an explicit null alias next to a value under the structured argument name', (): void => {
      expectConflict(
        'structured',
        { profile: null, p_profile: PROFILE },
        'profile',
        'p_profile'
      );
    });

    it('treats an undefined alias as absent next to a scalar argument name', (): void => {
      expect(
        boundValue('scalar', { flag: undefined, p_flag: 5 }, 'p_flag')
      ).toBe(5);
    });

    it('treats an undefined alias as absent next to a structured argument name', (): void => {
      expect(
        boundValue(
          'structured',
          { profile: undefined, p_profile: PROFILE },
          'p_profile'
        )
      ).toEqual(BOUND_PROFILE);
    });

    it('treats an undefined scalar argument name as absent next to its alias', (): void => {
      expect(
        boundValue('scalar', { flag: 5, p_flag: undefined }, 'p_flag')
      ).toBe(5);
    });

    it('treats an undefined structured argument name as absent next to its alias', (): void => {
      expect(
        boundValue(
          'structured',
          { profile: PROFILE, p_profile: undefined },
          'p_profile'
        )
      ).toEqual(BOUND_PROFILE);
    });
  });

  describe('own properties only', (): void => {
    it('does not read a scalar argument from the payload prototype', (): void => {
      const payload = Object.create({ flag: 1 }) as object;
      expect(boundValue('scalar', payload, 'p_flag')).toBeNull();
    });

    it('does not read a structured argument from the payload prototype', (): void => {
      const payload = Object.create({ profile: OTHER_PROFILE }) as object;
      expect(boundValue('structured', payload, 'p_profile')).toBeNull();
    });

    it('binds an own argument name rather than an alias inherited from the prototype', (): void => {
      const payload = Object.assign(Object.create({ flag: 1 }) as object, {
        p_flag: 5,
      });
      expect(boundValue('scalar', payload, 'p_flag')).toBe(5);
    });

    it('does not read an argument from a prototype getter of a class instance', (): void => {
      class FlagPayload {
        public get flag(): number {
          return 1;
        }
      }
      expect(boundValue('scalar', new FlagPayload(), 'p_flag')).toBeNull();
    });

    it('does not resolve an argument named constructor from Object.prototype', (): void => {
      expect(boundValue('constructor_name', {}, 'constructor')).toBeNull();
    });

    it('binds an own constructor key to an argument named constructor', (): void => {
      expect(
        boundValue('constructor_name', { constructor: 5 }, 'constructor')
      ).toBe(5);
    });

    it('does not resolve the constructor alias of p_constructor from Object.prototype', (): void => {
      expect(boundValue('constructor_alias', {}, 'p_constructor')).toBeNull();
    });

    it('binds p_constructor under its own name despite Object.prototype.constructor', (): void => {
      expect(
        boundValue('constructor_alias', { p_constructor: 5 }, 'p_constructor')
      ).toBe(5);
    });

    it('binds an own constructor key as the alias of p_constructor', (): void => {
      expect(
        boundValue('constructor_alias', { constructor: 6 }, 'p_constructor')
      ).toBe(6);
    });

    it('does not resolve the __proto__ alias of p___proto__ from the prototype chain', (): void => {
      expect(boundValue('proto_alias', {}, 'p___proto__')).toBeNull();
    });

    it('binds an own __proto__ key parsed from JSON as the alias of p___proto__', (): void => {
      const payload = JSON.parse('{"__proto__": 5}') as object;
      expect(boundValue('proto_alias', payload, 'p___proto__')).toBe(5);
    });

    it('reads a null-prototype payload under the alias and under the argument name', (): void => {
      expect(
        boundValue('scalar', nullPrototypePayload({ flag: 5 }), 'p_flag')
      ).toBe(5);
      expect(
        boundValue('scalar', nullPrototypePayload({ p_flag: 6 }), 'p_flag')
      ).toBe(6);
    });

    it('rejects a null-prototype payload that carries both the alias and the argument name', (): void => {
      expectConflict(
        'scalar',
        nullPrototypePayload({ flag: 5, p_flag: 6 }),
        'flag',
        'p_flag'
      );
    });
  });

  describe('positional payloads', (): void => {
    it('binds array elements by argument position', (): void => {
      const payload = [5, PROFILE, 'note'];
      expect(boundValue('positional', payload, 'p_flag')).toBe(5);
      expect(boundValue('positional', payload, 'p_profile')).toEqual(
        BOUND_PROFILE
      );
      expect(boundValue('positional', payload, 'p_note')).toBe('note');
    });

    it('binds null for missing, null and undefined elements', (): void => {
      const payload = [null, undefined];
      expect(boundValue('positional', payload, 'p_flag')).toBeNull();
      expect(boundValue('positional', payload, 'p_profile')).toBeNull();
      expect(boundValue('positional', payload, 'p_note')).toBeNull();
    });

    it('ignores named properties on an array payload', (): void => {
      const payload = Object.assign([7], { flag: 1, p_flag: 2 });
      expect(boundValue('positional', payload, 'p_flag')).toBe(7);
    });
  });
});
