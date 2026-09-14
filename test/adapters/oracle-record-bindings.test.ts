import oracledb from 'oracledb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import {
  OracleProcedureBindings,
  OracleRecordOutBinding,
} from '../../src/adapters/oracle/oracle-bindings.js';
import { OracleProcedureResultMaterializer } from '../../src/adapters/oracle/oracle-result-materializer.js';
import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { createLogger } from '../support/helpers.js';

import type {
  IProcedureStructuredType,
  TProcedureArgumentList,
  TProcedureArgumentMode,
} from '../../src/types/procedure.types.js';
import type { IBindingsObjectReturn } from '../../src/types/utility.types.js';

function recordType(
  timestampType = 'TIMESTAMP WITH TIME ZONE'
): IProcedureStructuredType {
  return {
    kind: 'oracle-record',
    owner: 'APP',
    packageName: 'PKG',
    typeName: 'SHIP_RECORD',
    fields: [
      { name: 'SHIP_NAME', argumentType: 'VARCHAR2', order: 1 },
      { name: 'WEIGHT', argumentType: 'NUMBER', order: 2 },
      { name: 'SAILED_AT', argumentType: timestampType, order: 3 },
      { name: 'TOKEN', argumentType: 'RAW', order: 4 },
    ],
  };
}

function procedureArguments(
  structuredType = recordType(),
  mode: TProcedureArgumentMode = 'IN/OUT'
): { run: TProcedureArgumentList['run'] } {
  return {
    run: [
      {
        argumentName: 'p_ship',
        argumentType: 'PL/SQL RECORD',
        order: 1,
        mode,
        structuredType,
      },
    ],
  };
}

function recordOutput(
  result: IBindingsObjectReturn,
  name = 'p_ship'
): OracleRecordOutBinding {
  const output = result.outBindings?.find((binding) => binding.name === name);
  if (!(output instanceof OracleRecordOutBinding))
    throw new Error(`Missing scalar RECORD output ${name}`);
  return output;
}

function namedBinds(result: IBindingsObjectReturn): Record<string, unknown> {
  if (Array.isArray(result.bindings))
    throw new Error('Expected named Oracle binds');
  return result.bindings;
}

function rawRecordFields(
  output: OracleRecordOutBinding,
  values: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    [...output.fieldBindings].map(([field, bind]) => [
      bind.toUpperCase(),
      values[field] ?? null,
    ])
  );
}

describe('Oracle RECORD scalar transport', (): void => {
  const builder = new OracleProcedureBindings();

  beforeEach((): void => {
    vi.spyOn(oracledb, 'thin', 'get').mockReturnValue(false);
    vi.spyOn(oracledb, 'oracleClientVersionString', 'get').mockReturnValue(
      '23.26.2.0.0'
    );
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it.each([
    ['TIMESTAMP WITH TIME ZONE', oracledb.DB_TYPE_TIMESTAMP_TZ],
    ['TIMESTAMP WITH LOCAL TIME ZONE', oracledb.DB_TYPE_TIMESTAMP_LTZ],
  ])(
    'transports a Thick RECORD containing %s through scalar binds',
    (timestampType, expectedType): void => {
      const token = Buffer.from([1, 2, 3, 4]);
      const result = builder.build(
        'pkg',
        'run',
        procedureArguments(recordType(timestampType)),
        {
          ship: {
            ship_name: "O'Reilly; END;",
            weight: 1200,
            sailed_at: '2026-07-16 12:30:45.123 +03:00',
            token,
          },
        }
      );
      const output = recordOutput(result);
      const binds = namedBinds(result);
      expect(output.databaseType).toBe('APP.PKG.SHIP_RECORD');
      expect(output.fieldBindings.size).toBe(4);
      expect(result.paramExecuteString).toMatch(
        /^DECLARE \w+ APP\.PKG\.SHIP_RECORD; BEGIN /u
      );
      expect(result.paramExecuteString.match(/PKG\.RUN \(/gu)).toHaveLength(1);
      expect(result.paramExecuteString).not.toContain("O'Reilly");
      expect(binds).not.toHaveProperty('p_ship');

      const expectedValues = new Map<string, unknown>([
        ['SHIP_NAME', "O'Reilly; END;"],
        ['WEIGHT', 1200],
        ['SAILED_AT', new Date('2026-07-16T09:30:45.123Z')],
        ['TOKEN', token],
      ]);
      const callPosition = result.paramExecuteString.indexOf('PKG.RUN (');
      for (const [field, bind] of output.fieldBindings) {
        expect(binds[bind]).toMatchObject({
          dir: oracledb.BIND_INOUT,
          val: expectedValues.get(field),
        });
        const assignment = result.paramExecuteString.match(
          new RegExp(`(\\w+)\\."${field}" := :${bind};`, 'u')
        );
        if (!assignment?.[1]) throw new Error(`Missing input field ${field}`);
        expect(assignment.index).toBeLessThan(callPosition);
        expect(
          result.paramExecuteString.indexOf(
            `:${bind} := ${assignment[1]}."${field}";`
          )
        ).toBeGreaterThan(callPosition);
        if (field === 'SAILED_AT')
          expect(binds[bind]).toMatchObject({ type: expectedType });
        if (field === 'TOKEN' || field === 'SHIP_NAME')
          expect(binds[bind]).toMatchObject({ maxSize: 32_767 });
      }
    }
  );

  it('keeps record modes and scalar arguments in the procedure order', (): void => {
    const structuredType = recordType();
    const result = builder.build(
      'pkg',
      'run',
      {
        run: [
          {
            argumentName: 'p_count',
            argumentType: 'NUMBER',
            order: 1,
            mode: 'IN',
          },
          {
            argumentName: 'p_input',
            argumentType: 'PL/SQL RECORD',
            order: 2,
            mode: 'IN',
            structuredType,
          },
          {
            argumentName: 'p_output',
            argumentType: 'PL/SQL RECORD',
            order: 3,
            mode: 'OUT',
            structuredType,
          },
          {
            argumentName: 'p_in_out',
            argumentType: 'PL/SQL RECORD',
            order: 4,
            mode: 'IN/OUT',
            structuredType,
          },
          {
            argumentName: 'out_cursor',
            argumentType: 'REF CURSOR',
            order: 5,
            mode: 'OUT',
          },
        ],
      },
      { count: 7, input: null, in_out: { ship_name: 'before' } }
    );
    const binds = namedBinds(result);
    const call = /PKG\.RUN \(:p_count,(\w+),(\w+),(\w+),:out_cursor\);/u.exec(
      result.paramExecuteString
    );
    if (!call) throw new Error('Missing ordered procedure call');
    const [, inputVariable, outputVariable, inOutVariable] = call;
    expect(new Set([inputVariable, outputVariable, inOutVariable]).size).toBe(
      3
    );
    expect(binds.p_count).toEqual({
      dir: oracledb.BIND_IN,
      type: oracledb.NUMBER,
      val: 7,
    });
    expect(result.cursorsNames).toEqual(['out_cursor']);
    expect(result.outNames).toEqual(['p_output', 'p_in_out', 'out_cursor']);
    expect(
      Object.values(binds).filter(
        (bind) =>
          typeof bind === 'object' &&
          bind !== null &&
          'dir' in bind &&
          bind.dir === oracledb.BIND_IN
      )
    ).toHaveLength(5);
    for (const field of structuredType.fields) {
      expect(result.paramExecuteString).toContain(
        `${inputVariable}."${field.name}" := :`
      );
      expect(result.paramExecuteString).not.toContain(
        `:= ${inputVariable}."${field.name}";`
      );
      expect(result.paramExecuteString).not.toContain(
        `${outputVariable}."${field.name}" := :`
      );
      const inputBind = new RegExp(
        `${inputVariable}\\."${field.name}" := :(\\w+);`,
        'u'
      ).exec(result.paramExecuteString)?.[1];
      if (inputBind === undefined) throw new Error('Missing input bind');
      expect(binds[inputBind]).toMatchObject({ val: null });
      for (const name of ['p_output', 'p_in_out']) {
        const output = recordOutput(result, name);
        const bind = output.fieldBindings.get(field.name);
        if (bind === undefined) throw new Error('Missing output mapping');
        expect(binds[bind]).toMatchObject({
          dir: name === 'p_output' ? oracledb.BIND_OUT : oracledb.BIND_INOUT,
        });
      }
    }
  });

  it('avoids bind and local variable collisions with argument, owner and package names', (): void => {
    const structuredType = {
      ...recordType(),
      owner: 'TPK_RECORD_1',
      packageName: 'TPK_RECORD_2',
    };
    const result = builder.build(
      'tpk_record_0',
      'run',
      {
        run: [
          {
            argumentName: 'TPK_RECORD_3',
            argumentType: 'NUMBER',
            order: 1,
            mode: 'IN',
          },
          ...procedureArguments(structuredType).run,
        ],
      },
      { TPK_RECORD_3: 17, ship: null }
    );
    const binds = namedBinds(result);
    expect(binds.TPK_RECORD_3).toMatchObject({ val: 17 });
    const declaration = /^DECLARE (\w+) /u.exec(result.paramExecuteString)?.[1];
    const names = [declaration, ...recordOutput(result).fieldBindings.values()];
    for (const name of names)
      expect([
        'tpk_record_0',
        'tpk_record_1',
        'tpk_record_2',
        'tpk_record_3',
      ]).not.toContain(name);
    expect(new Set(names).size).toBe(names.length);
    expect(result.paramExecuteString).toContain(
      'TPK_RECORD_0.RUN (:TPK_RECORD_3,'
    );
  });

  it.each([
    { isThin: true, timestampType: 'TIMESTAMP WITH TIME ZONE' },
    { isThin: false, timestampType: 'TIMESTAMP' },
  ])(
    'keeps native RECORD binds for $timestampType with thin=$isThin',
    ({ isThin, timestampType }): void => {
      vi.spyOn(oracledb, 'thin', 'get').mockReturnValue(isThin);
      const result = builder.build(
        'pkg',
        'run',
        procedureArguments(recordType(timestampType)),
        { ship: null }
      );
      expect(result.paramExecuteString).toBe('BEGIN PKG.RUN (:p_ship); END;');
      expect(namedBinds(result)).toEqual({
        p_ship: {
          dir: oracledb.BIND_INOUT,
          type: 'APP.PKG.SHIP_RECORD',
          val: { SHIP_NAME: null, WEIGHT: null, SAILED_AT: null, TOKEN: null },
        },
      });
      expect(result.outBindings?.[0]).not.toBeInstanceOf(
        OracleRecordOutBinding
      );
    }
  );

  it('preserves a native IN null while initializing null INOUT fields for output assignment', (): void => {
    vi.spyOn(oracledb, 'thin', 'get').mockReturnValue(true);
    const input = builder.build(
      'pkg',
      'run',
      procedureArguments(recordType(), 'IN'),
      { ship: null }
    );
    const inOut = builder.build('pkg', 'run', procedureArguments(), {
      ship: null,
    });
    expect(namedBinds(input).p_ship).toMatchObject({ val: null });
    expect(namedBinds(inOut).p_ship).toMatchObject({
      val: { SHIP_NAME: null, WEIGHT: null, SAILED_AT: null, TOKEN: null },
    });
  });

  it('quotes mixed-case and reserved RECORD field identifiers', (): void => {
    const structuredType = {
      ...recordType(),
      fields: [
        { name: 'select', argumentType: 'NUMBER', order: 1 },
        {
          name: 'SailedAt',
          argumentType: 'TIMESTAMP WITH TIME ZONE',
          order: 2,
        },
      ],
    };
    const result = builder.build(
      'pkg',
      'run',
      procedureArguments(structuredType),
      {
        ship: { select: 5, sailedat: '2026-07-16 12:30:45 +03:00' },
      }
    );
    const output = recordOutput(result);
    for (const [field, bind] of output.fieldBindings) {
      expect(result.paramExecuteString).toContain(`."${field}" := :${bind};`);
      expect(result.paramExecuteString).toMatch(
        new RegExp(`:${bind} := \\w+\\."${field}";`, 'u')
      );
    }
  });

  it.each([
    ['PL/SQL BOOLEAN', false, oracledb.DB_TYPE_BOOLEAN],
    ['PL/SQL PLS INTEGER', 0, oracledb.DB_TYPE_BINARY_INTEGER],
    ['PL/SQL BINARY INTEGER', -1, oracledb.DB_TYPE_BINARY_INTEGER],
    ['BINARY_FLOAT', 1.25, oracledb.DB_TYPE_BINARY_FLOAT],
    ['BINARY_DOUBLE', 2.5, oracledb.DB_TYPE_BINARY_DOUBLE],
    ['NVARCHAR2', 'Имя', oracledb.DB_TYPE_NVARCHAR],
    ['DATE', new Date(2026, 6, 16, 12, 30), oracledb.DB_TYPE_DATE],
    [
      'TIMESTAMP',
      new Date(2026, 6, 16, 12, 30, 45, 123),
      oracledb.DB_TYPE_TIMESTAMP,
    ],
  ])(
    'preserves a %s field alongside the zoned timestamp',
    (argumentType, value, type): void => {
      const structuredType = recordType();
      structuredType.fields.push({ name: 'EXTRA', argumentType, order: 5 });
      const result = builder.build(
        'pkg',
        'run',
        procedureArguments(structuredType),
        {
          ship: { extra: value },
        }
      );
      const bind = recordOutput(result).fieldBindings.get('EXTRA');
      if (bind === undefined)
        throw new Error('Missing additional field mapping');
      expect(namedBinds(result)[bind]).toMatchObject({
        dir: oracledb.BIND_INOUT,
        type,
        val: value,
      });
    }
  );

  it.each([
    [{ extra: 'unknown' }, 'contains unknown fields: extra'],
    [{ ship_name: ['array'] }, 'Oracle array bind'],
    [{ token: 'text' }, 'Invalid RAW value'],
    [{ SHIP_NAME: 'one', ship_name: 'two' }, 'contains conflicting field'],
    [
      { sailed_at: new Date(Number.NaN) },
      'Invalid TIMESTAMP WITH TIME ZONE value',
    ],
  ])('validates scalar RECORD input %j', (ship, message): void => {
    expect(() =>
      builder.build('pkg', 'run', procedureArguments(), { ship })
    ).toThrow(message);
  });

  it('reconstructs named scalar outputs and preserves field serializers and nulls', async (): Promise<void> => {
    const result = builder.build('pkg', 'run', procedureArguments(), {
      ship: null,
    });
    const output = recordOutput(result);
    const options = {
      isNeedRegisterDefaultSerializers: true,
      caseStrategy: {
        transformColumnName: (name: string): string => name.toLowerCase(),
      },
    };
    const serializer = new OracleSerializer(createLogger(), options);
    serializer.registerFetchHandlerHook();
    const materializer = new OracleProcedureResultMaterializer(
      createLogger(),
      options,
      serializer
    );
    const token = Buffer.from([1, 2, 3, 4]);
    try {
      await expect(
        materializer.materialize(
          [],
          [output],
          rawRecordFields(output, {
            SHIP_NAME: 'after',
            WEIGHT: 0,
            SAILED_AT: new Date('2026-07-16T09:30:45.123Z'),
            TOKEN: token,
          })
        )
      ).resolves.toEqual({
        rows: [],
        outBinds: {
          p_ship: {
            ship_name: 'after',
            weight: 0,
            sailed_at: '2026-07-16T09:30:45.123Z',
            token,
          },
        },
      });
      await expect(
        materializer.materialize([], [output], rawRecordFields(output, {}))
      ).resolves.toEqual({
        rows: [],
        outBinds: {
          p_ship: {
            ship_name: null,
            weight: null,
            sailed_at: null,
            token: null,
          },
        },
      });
      const missingField = rawRecordFields(output, {});
      const timestampBind = output.fieldBindings.get('SAILED_AT');
      if (timestampBind === undefined)
        throw new Error('Missing timestamp mapping');
      delete missingField[timestampBind.toUpperCase()];
      await expect(
        materializer.materialize([], [output], missingField)
      ).rejects.toThrow(
        'Oracle RECORD field "p_ship.SAILED_AT" was not returned'
      );
    } finally {
      serializer.deleteAllSerializers();
    }
  });

  it('does not retry a procedure after an Oracle execution error', async (): Promise<void> => {
    const dataSource = new DataSource({ type: 'oracle' });
    const manager = dataSource.manager;
    const error = new Error('ORA-01891: Datetime/Interval internal error');
    const query = vi.spyOn(manager, 'query').mockRejectedValue(error);
    vi.spyOn(manager, 'transaction').mockImplementation(
      async (run): Promise<unknown> => {
        if (typeof run !== 'function')
          throw new Error('Expected transaction callback');
        return run(manager);
      }
    );
    const adapter = new OracleAdapter(dataSource, createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (name: string): string => name.toLowerCase(),
      },
    });
    const result = builder.build('pkg', 'run', procedureArguments(), {
      ship: null,
    });
    await expect(
      adapter.executeProcedure(
        result.paramExecuteString,
        manager,
        [],
        result.bindings,
        result.cursorsNames,
        result.outBindings
      )
    ).rejects.toBe(error);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      result.paramExecuteString,
      result.bindings
    );
  });
});
