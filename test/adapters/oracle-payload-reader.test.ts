import oracledb from 'oracledb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
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
 * `OracleAdapter.makeBindings` with real procedure metadata. The same cases,
 * under the same names, run against PostgreSQL in
 * `postgre-payload-reader.test.ts`, so the two vendors can be compared case by
 * case.
 */

const shipRecordType = {
  kind: 'oracle-record',
  owner: 'APP',
  packageName: 'PKG',
  typeName: 'SHIP_RECORD',
  fields: [
    { name: 'SHIP_NAME', argumentType: 'VARCHAR2', order: 1 },
    { name: 'WEIGHT', argumentType: 'NUMBER', order: 2 },
  ],
} satisfies IProcedureStructuredType;

const procedures = {
  scalar: [
    { argumentName: 'p_flag', argumentType: 'NUMBER', order: 1, mode: 'IN' },
  ],
  structured: [
    {
      argumentName: 'p_ship',
      argumentType: 'PL/SQL RECORD',
      order: 1,
      mode: 'IN',
      structuredType: shipRecordType,
    },
  ],
  unprefixed: [
    { argumentName: 'flag', argumentType: 'NUMBER', order: 1, mode: 'IN' },
  ],
  constructor_name: [
    {
      argumentName: 'constructor',
      argumentType: 'NUMBER',
      order: 1,
      mode: 'IN',
    },
  ],
  constructor_alias: [
    {
      argumentName: 'p_constructor',
      argumentType: 'NUMBER',
      order: 1,
      mode: 'IN',
    },
  ],
  proto_alias: [
    {
      argumentName: 'p___proto__',
      argumentType: 'NUMBER',
      order: 1,
      mode: 'IN',
    },
  ],
  positional: [
    { argumentName: 'p_flag', argumentType: 'NUMBER', order: 1, mode: 'IN' },
    {
      argumentName: 'p_ship',
      argumentType: 'PL/SQL RECORD',
      order: 2,
      mode: 'IN',
      structuredType: shipRecordType,
    },
    { argumentName: 'p_note', argumentType: 'VARCHAR2', order: 3, mode: 'IN' },
  ],
} satisfies TProcedureArgumentList;

const SHIP = { ship_name: 'Endurance', weight: 350 };
const OTHER_SHIP = { ship_name: 'Nimrod', weight: 41 };
/** `SHIP` as the RECORD value handed to the driver, keyed by declared field. */
const BOUND_SHIP = { SHIP_NAME: 'Endurance', WEIGHT: 350 };

function createOracleAdapter(): OracleAdapter {
  return new OracleAdapter(
    {
      options: { replication: { master: {} } },
      driver: { version: '19.0.0.0.0', setFetchTypeHandler: vi.fn() },
    } as never,
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
  return createOracleAdapter().makeBindings(
    'pkg',
    processName,
    procedures,
    payload
  );
}

/** The `val` Oracle receives for one argument (named binds, keyed by argument). */
function boundValue(
  processName: keyof typeof procedures,
  payload: TProcedurePayload | null | undefined,
  argumentName: string
): unknown {
  const { bindings } = bind(processName, payload);
  if (Array.isArray(bindings)) throw new Error('Expected named Oracle binds');
  const binding: unknown = bindings[argumentName];
  if (typeof binding !== 'object' || binding === null)
    throw new Error(`Missing Oracle bind "${argumentName}"`);
  if (!Object.hasOwn(binding, 'val'))
    throw new Error(`Oracle bind "${argumentName}" carries no value`);
  return (binding as { val: unknown }).val;
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
    `Conflicting Oracle procedure payload keys: "${aliasName}" and "${argumentName}"`
  );
}

function nullPrototypePayload(values: Record<string, unknown>): object {
  return Object.assign(Object.create(null) as object, values);
}

describe('Oracle procedure payload reader', (): void => {
  beforeEach((): void => {
    // Keep RECORD arguments on the single object-bind path regardless of the
    // driver mode the test process happens to run in.
    vi.spyOn(oracledb, 'thin', 'get').mockReturnValue(true);
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  describe('alias conflict', (): void => {
    it('rejects a scalar argument supplied under both its name and its p_-stripped alias', (): void => {
      expectConflict('scalar', { flag: 1, p_flag: 2 }, 'flag', 'p_flag');
    });

    it('rejects a structured argument supplied under both its name and its p_-stripped alias', (): void => {
      expectConflict(
        'structured',
        { ship: SHIP, p_ship: OTHER_SHIP },
        'ship',
        'p_ship'
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
      expect(boundValue('structured', { ship: null }, 'p_ship')).toBeNull();
    });

    it('binds an explicit null supplied under the name of a scalar argument', (): void => {
      expect(boundValue('scalar', { p_flag: null }, 'p_flag')).toBeNull();
    });

    it('binds an explicit null supplied under the name of a structured argument', (): void => {
      expect(boundValue('structured', { p_ship: null }, 'p_ship')).toBeNull();
    });

    it('rejects an explicit null alias next to a value under the scalar argument name', (): void => {
      expectConflict('scalar', { flag: null, p_flag: 5 }, 'flag', 'p_flag');
    });

    it('rejects an explicit null alias next to a value under the structured argument name', (): void => {
      expectConflict(
        'structured',
        { ship: null, p_ship: SHIP },
        'ship',
        'p_ship'
      );
    });

    it('treats an undefined alias as absent next to a scalar argument name', (): void => {
      expect(
        boundValue('scalar', { flag: undefined, p_flag: 5 }, 'p_flag')
      ).toBe(5);
    });

    it('treats an undefined alias as absent next to a structured argument name', (): void => {
      expect(
        boundValue('structured', { ship: undefined, p_ship: SHIP }, 'p_ship')
      ).toEqual(BOUND_SHIP);
    });

    it('treats an undefined scalar argument name as absent next to its alias', (): void => {
      expect(
        boundValue('scalar', { flag: 5, p_flag: undefined }, 'p_flag')
      ).toBe(5);
    });

    it('treats an undefined structured argument name as absent next to its alias', (): void => {
      expect(
        boundValue('structured', { ship: SHIP, p_ship: undefined }, 'p_ship')
      ).toEqual(BOUND_SHIP);
    });
  });

  describe('own properties only', (): void => {
    it('does not read a scalar argument from the payload prototype', (): void => {
      const payload = Object.create({ flag: 1 }) as object;
      expect(boundValue('scalar', payload, 'p_flag')).toBeNull();
    });

    it('does not read a structured argument from the payload prototype', (): void => {
      const payload = Object.create({ ship: OTHER_SHIP }) as object;
      expect(boundValue('structured', payload, 'p_ship')).toBeNull();
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
      const payload = [5, SHIP, 'note'];
      expect(boundValue('positional', payload, 'p_flag')).toBe(5);
      expect(boundValue('positional', payload, 'p_ship')).toEqual(BOUND_SHIP);
      expect(boundValue('positional', payload, 'p_note')).toBe('note');
    });

    it('binds null for missing, null and undefined elements', (): void => {
      const payload = [null, undefined];
      expect(boundValue('positional', payload, 'p_flag')).toBeNull();
      expect(boundValue('positional', payload, 'p_ship')).toBeNull();
      expect(boundValue('positional', payload, 'p_note')).toBeNull();
    });

    it('ignores named properties on an array payload', (): void => {
      const payload = Object.assign([7], { flag: 1, p_flag: 2 });
      expect(boundValue('positional', payload, 'p_flag')).toBe(7);
    });
  });
});
