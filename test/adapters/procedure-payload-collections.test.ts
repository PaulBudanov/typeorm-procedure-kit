import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
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
 * A `Map` or `Set` handed to a procedure call as its payload, driven through
 * each adapter's `makeBindings` with real procedure metadata. Neither carries
 * its entries as properties, so both vendors reject it with their own name
 * rather than binding `NULL` to every argument.
 */

type TVendorName = 'Oracle' | 'PostgreSQL';

interface IVendorCase {
  readonly vendorName: TVendorName;
  readonly bind: (
    processName: 'scalar' | 'structured',
    payload: TProcedurePayload
  ) => IBindingsObjectReturn;
}

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

const oracleProcedures = {
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
} satisfies TProcedureArgumentList;

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

const postgreProcedures = {
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
} satisfies TProcedureArgumentList;

const VENDOR_CASES: ReadonlyArray<IVendorCase> = [
  {
    vendorName: 'Oracle',
    bind: (processName, payload): IBindingsObjectReturn =>
      new OracleAdapter(
        {
          options: { replication: { master: {} } },
          driver: { version: '19.0.0.0.0', setFetchTypeHandler: vi.fn() },
        } as never,
        createLogger(),
        {
          isNeedRegisterDefaultSerializers: false,
          caseStrategy: {
            transformColumnName: (value: string): string => value,
          },
        }
      ).makeBindings('pkg', processName, oracleProcedures, payload),
  },
  {
    vendorName: 'PostgreSQL',
    bind: (processName, payload): IBindingsObjectReturn =>
      new PostgreAdapter(
        { options: { replication: { master: {} } } } as never,
        createLogger(),
        {
          isNeedRegisterDefaultSerializers: false,
          caseStrategy: {
            transformColumnName: (value: string): string => value,
          },
        }
      ).makeBindings('pkg', processName, postgreProcedures, payload),
  },
];

function thrownBy(bind: () => unknown): unknown {
  try {
    bind();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected makeBindings to throw');
}

describe.each(VENDOR_CASES)(
  '$vendorName procedure payload collections',
  ({ vendorName, bind }): void => {
    const mapMessage = `${vendorName} procedure payload is a Map, whose entries are not read as argument keys; pass a plain object, for example \`Object.fromEntries(map)\``;
    const setMessage = `${vendorName} procedure payload is a Set, whose values are not read as arguments; pass a plain object, or an array to bind by position, for example \`Array.from(set)\``;

    it('rejects a Map payload for a scalar argument', (): void => {
      const error = thrownBy(() => bind('scalar', new Map([['flag', 5]])));
      expect(error).toBeInstanceOf(ServerError);
      expect((error as Error).message).toBe(mapMessage);
    });

    it('rejects a Map payload for a structured argument', (): void => {
      const error = thrownBy(() => bind('structured', new Map()));
      expect(error).toBeInstanceOf(ServerError);
      expect((error as Error).message).toBe(mapMessage);
    });

    it('rejects a Set payload for a scalar argument', (): void => {
      const error = thrownBy(() => bind('scalar', new Set([5])));
      expect(error).toBeInstanceOf(ServerError);
      expect((error as Error).message).toBe(setMessage);
    });
  }
);
