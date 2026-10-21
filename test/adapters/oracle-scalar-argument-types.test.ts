import oracledb from 'oracledb';
import { describe, expect, it } from 'vitest';

import { OracleProcedureBindings } from '../../src/adapters/oracle/oracle-bindings.js';

import type {
  TProcedureArgumentList,
  TProcedureArgumentMode,
  TProcedurePayload,
} from '../../src/types/procedure.types.js';
import type { IBindingsObjectReturn } from '../../src/types/utility.types.js';

const ARGUMENT_NAME = 'p_arg';

/**
 * The complete set of scalar argument types Oracle procedures may declare.
 * Pinned here so that narrowing the whitelist is a deliberate, visible change
 * rather than a silent regression.
 */
const SUPPORTED_SCALAR_TYPES: ReadonlyArray<
  readonly [string, oracledb.DbType]
> = [
  ['NUMBER', oracledb.DB_TYPE_NUMBER],
  ['INTEGER', oracledb.DB_TYPE_NUMBER],
  ['SMALLINT', oracledb.DB_TYPE_NUMBER],
  ['DECIMAL', oracledb.DB_TYPE_NUMBER],
  ['NUMERIC', oracledb.DB_TYPE_NUMBER],
  ['REAL', oracledb.DB_TYPE_NUMBER],
  ['FLOAT', oracledb.DB_TYPE_NUMBER],
  ['DOUBLE PRECISION', oracledb.DB_TYPE_NUMBER],
  ['BINARY_FLOAT', oracledb.DB_TYPE_BINARY_FLOAT],
  ['BINARY_DOUBLE', oracledb.DB_TYPE_BINARY_DOUBLE],
  ['BINARY_INTEGER', oracledb.DB_TYPE_BINARY_INTEGER],
  ['PLS_INTEGER', oracledb.DB_TYPE_BINARY_INTEGER],
  ['PL/SQL BINARY INTEGER', oracledb.DB_TYPE_BINARY_INTEGER],
  ['PL/SQL PLS INTEGER', oracledb.DB_TYPE_BINARY_INTEGER],
  ['BOOLEAN', oracledb.DB_TYPE_BOOLEAN],
  ['PL/SQL BOOLEAN', oracledb.DB_TYPE_BOOLEAN],
  ['STRING', oracledb.DB_TYPE_VARCHAR],
  ['VARCHAR', oracledb.DB_TYPE_VARCHAR],
  ['VARCHAR2', oracledb.DB_TYPE_VARCHAR],
  ['NVARCHAR2', oracledb.DB_TYPE_NVARCHAR],
  ['CHAR', oracledb.DB_TYPE_CHAR],
  ['NCHAR', oracledb.DB_TYPE_NCHAR],
  ['RAW', oracledb.DB_TYPE_RAW],
  ['BUFFER', oracledb.DB_TYPE_RAW],
  ['DATE', oracledb.DB_TYPE_DATE],
  ['TIMESTAMP', oracledb.DB_TYPE_TIMESTAMP],
  ['TIMESTAMP WITH TIME ZONE', oracledb.DB_TYPE_TIMESTAMP_TZ],
  ['TIMESTAMP WITH LOCAL TIME ZONE', oracledb.DB_TYPE_TIMESTAMP_LTZ],
  ['CLOB', oracledb.DB_TYPE_CLOB],
  ['BLOB', oracledb.DB_TYPE_BLOB],
  ['REF CURSOR', oracledb.DB_TYPE_CURSOR],
];

/** Types that stay outside the whitelist; see the JSDoc above `typeMapping`. */
const UNSUPPORTED_SCALAR_TYPES: ReadonlyArray<string> = [
  'NCLOB',
  'LONG',
  'LONG RAW',
  'BFILE',
  'ROWID',
  'UROWID',
  'XMLTYPE',
  'JSON',
  'VECTOR',
  'INTERVAL DAY TO SECOND',
  'INTERVAL YEAR TO MONTH',
  'PL/SQL TABLE',
  'TABLE',
  'OBJECT',
  'REF',
];

/** Scalar types whose OUT binds need an explicit driver buffer size. */
const VARIABLE_SIZE_TYPES: ReadonlyArray<string> = [
  'STRING',
  'VARCHAR',
  'VARCHAR2',
  'NVARCHAR2',
  'CHAR',
  'NCHAR',
  'RAW',
  'BUFFER',
];

const FIXED_SIZE_TYPES: ReadonlyArray<string> = SUPPORTED_SCALAR_TYPES.map(
  ([name]) => name
).filter(
  (name) => !VARIABLE_SIZE_TYPES.includes(name) && name !== 'REF CURSOR'
);

interface IScalarTypeMappingInternals {
  typeMapping: Record<string, oracledb.DbType>;
}

/**
 * `typeMapping` is private to the builder, but the exact whitelist is the
 * contract this suite exists to pin, so it is read directly instead of being
 * inferred from a necessarily open-ended list of probe types.
 */
function scalarTypeMapping(
  builder: OracleProcedureBindings
): Record<string, oracledb.DbType> {
  return (builder as unknown as IScalarTypeMappingInternals).typeMapping;
}

function scalarArgument(
  argumentType: string,
  mode: TProcedureArgumentMode = 'IN',
  size?: number
): TProcedureArgumentList {
  return {
    run: [
      {
        argumentName: ARGUMENT_NAME,
        argumentType,
        order: 1,
        mode,
        ...(size === undefined ? {} : { size }),
      },
    ],
  };
}

function buildScalar(
  argumentType: string,
  mode: TProcedureArgumentMode = 'IN',
  payload?: TProcedurePayload,
  size?: number
): unknown {
  const builder = new OracleProcedureBindings();
  const result: IBindingsObjectReturn = builder.build(
    'pkg',
    'run',
    scalarArgument(argumentType, mode, size),
    payload
  );
  const { bindings } = result;
  if (Array.isArray(bindings)) throw new Error('Expected named Oracle binds');
  return bindings[ARGUMENT_NAME];
}

describe('Oracle scalar argument types', (): void => {
  it('pins the complete set of supported scalar argument types', (): void => {
    const mapping = scalarTypeMapping(new OracleProcedureBindings());

    expect(Object.keys(mapping).sort()).toEqual(
      SUPPORTED_SCALAR_TYPES.map(([name]) => name).sort()
    );
  });

  it.each(SUPPORTED_SCALAR_TYPES)(
    'binds %s as an IN argument',
    (argumentType, expectedType): void => {
      expect(buildScalar(argumentType)).toMatchObject({
        dir: oracledb.BIND_IN,
        type: expectedType,
      });
    }
  );

  it.each(UNSUPPORTED_SCALAR_TYPES)(
    'rejects %s with a clear error',
    (argumentType): void => {
      expect(() => buildScalar(argumentType)).toThrow(
        `Invalid data type: ${argumentType}`
      );
    }
  );

  it('binds a CHAR argument to its payload value', (): void => {
    expect(buildScalar('CHAR', 'IN', { arg: 'Y' })).toMatchObject({
      dir: oracledb.BIND_IN,
      type: oracledb.DB_TYPE_CHAR,
      val: 'Y',
    });
  });

  it('binds a BOOLEAN argument to its payload value', (): void => {
    expect(buildScalar('BOOLEAN', 'IN', { arg: true })).toMatchObject({
      dir: oracledb.BIND_IN,
      type: oracledb.DB_TYPE_BOOLEAN,
      val: true,
    });
  });

  it('binds a PLS_INTEGER argument to its payload value', (): void => {
    expect(buildScalar('PLS_INTEGER', 'IN', { arg: 42 })).toMatchObject({
      dir: oracledb.BIND_IN,
      type: oracledb.DB_TYPE_BINARY_INTEGER,
      val: 42,
    });
  });

  it.each(VARIABLE_SIZE_TYPES)(
    'gives an OUT %s bind an explicit maxSize',
    (argumentType): void => {
      expect(buildScalar(argumentType, 'OUT')).toMatchObject({
        dir: oracledb.BIND_OUT,
        maxSize: 32_767,
      });
    }
  );

  it.each(VARIABLE_SIZE_TYPES)(
    'gives an IN/OUT %s bind an explicit maxSize',
    (argumentType): void => {
      expect(buildScalar(argumentType, 'IN/OUT')).toMatchObject({
        dir: oracledb.BIND_INOUT,
        maxSize: 32_767,
      });
    }
  );

  it.each(FIXED_SIZE_TYPES)(
    'leaves an OUT %s bind without maxSize',
    (argumentType): void => {
      expect(buildScalar(argumentType, 'OUT')).not.toHaveProperty('maxSize');
    }
  );

  it.each(VARIABLE_SIZE_TYPES)(
    'leaves an IN %s bind without maxSize',
    (argumentType): void => {
      expect(buildScalar(argumentType)).not.toHaveProperty('maxSize');
    }
  );

  it('clamps the OUT maxSize to the size reported by metadata', (): void => {
    expect(buildScalar('NCHAR', 'OUT', undefined, 1_000)).toMatchObject({
      maxSize: 1_000,
    });
    expect(buildScalar('NCHAR', 'OUT', undefined, 10)).toMatchObject({
      maxSize: 201,
    });
    expect(buildScalar('NCHAR', 'OUT', undefined, 99_999)).toMatchObject({
      maxSize: 32_767,
    });
  });
});
