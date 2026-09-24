import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { OracleRecordMetadataParser } from '../../src/adapters/oracle/oracle-record-metadata-parser.js';
import { DEFAULT_RESOURCE_LIMITS } from '../../src/utils/resource-limits.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

import type { IProcedureStructuredType } from '../../src/types/procedure.types.js';

function createOracleAdapter(databaseVersion = '19.0.0.0.0'): OracleAdapter {
  return new OracleAdapter(
    {
      options: { replication: { master: {} } },
      driver: { version: databaseVersion, setFetchTypeHandler: vi.fn() },
    } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: { transformColumnName: (value: string) => value },
      resourceLimits: { ...DEFAULT_RESOURCE_LIMITS },
    }
  );
}

/** Parser wired to a gate that never rejects, as Oracle 19c would behave. */
function createParser(): OracleRecordMetadataParser {
  return new OracleRecordMetadataParser((): void => undefined);
}

/** Pins both the error class and the exact message text. */
function expectServerError(run: () => unknown, message: string): void {
  let caught: unknown;
  let hasThrown = false;
  try {
    run();
  } catch (error) {
    caught = error;
    hasThrown = true;
  }
  expect(hasThrown).toBe(true);
  expect(caught).toBeInstanceOf(ServerError);
  expect((caught as ServerError).message).toBe(message);
}

const recordRow: Record<string, unknown> = {
  procedureName: 'RUN',
  argumentName: 'P_RECORD',
  argumentType: 'PL/SQL RECORD',
  order: 1,
  mode: 'IN',
  dataLevel: 0,
  sequence: 1,
  typeOwner: 'APP',
  typeName: 'PKG',
  typeSubname: 'RECORD_TYPE',
  plsqlTypecode: 'PL/SQL RECORD',
};
const fieldRow: Record<string, unknown> = {
  procedureName: 'RUN',
  argumentName: 'NAME',
  argumentType: 'VARCHAR2',
  order: 1,
  mode: 'IN',
  dataLevel: 1,
  sequence: 1,
  typeOwner: null,
  typeName: null,
  typeSubname: null,
  plsqlTypecode: null,
};
const scalarRow: Record<string, unknown> = {
  procedureName: 'RUN',
  argumentName: 'P_VALUE',
  argumentType: 'NUMBER',
  order: 2,
  mode: 'IN',
  dataLevel: 0,
  sequence: 2,
  typeOwner: null,
  typeName: null,
  typeSubname: null,
  plsqlTypecode: null,
};

describe('OracleRecordMetadataParser', (): void => {
  it('folds RECORD field rows into the parent argument row', (): void => {
    const prepared = createParser().prepareRows([
      recordRow,
      fieldRow,
      { ...fieldRow, argumentName: 'SAILED_AT', sequence: 2 },
      { ...fieldRow, argumentName: 'WEIGHT', argumentType: 'NUMBER' },
      scalarRow,
    ]);

    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toEqual({
      ...recordRow,
      size: null,
      structuredType: {
        kind: 'oracle-record',
        owner: 'APP',
        packageName: 'PKG',
        typeName: 'RECORD_TYPE',
        fields: [
          { name: 'NAME', argumentType: 'VARCHAR2', order: 1 },
          { name: 'SAILED_AT', argumentType: 'VARCHAR2', order: 2 },
          { name: 'WEIGHT', argumentType: 'NUMBER', order: 1 },
        ],
      },
    });
    expect(prepared[1]).toBe(scalarRow);
  });

  it.each([
    ['TIMESTAMP WITH TZ', 'TIMESTAMP WITH TIME ZONE'],
    ['TIMESTAMP WITH LOCAL TZ', 'TIMESTAMP WITH LOCAL TIME ZONE'],
    ['TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITH TIME ZONE'],
    ['varchar2', 'VARCHAR2'],
  ])('normalizes the %s field type to %s', (dictionaryType, expected): void => {
    const [prepared] = createParser().prepareRows([
      recordRow,
      { ...fieldRow, argumentType: dictionaryType },
    ]);

    expect(
      (prepared?.structuredType as IProcedureStructuredType).fields
    ).toEqual([{ name: 'NAME', argumentType: expected, order: 1 }]);
  });

  it.each(['PL/SQL RECORD', 'RECORD', '  record  '])(
    'treats the %s type code as a package RECORD',
    (plsqlTypecode): void => {
      const [prepared] = createParser().prepareRows([
        { ...recordRow, plsqlTypecode },
        fieldRow,
      ]);

      expect((prepared?.structuredType as IProcedureStructuredType).kind).toBe(
        'oracle-record'
      );
    }
  );

  it('passes rows without a dataLevel and schema SQL objects through', (): void => {
    const sqlObjectRow: Record<string, unknown> = {
      ...recordRow,
      argumentType: 'OBJECT',
      typeSubname: null,
      plsqlTypecode: null,
    };
    const looseRow: Record<string, unknown> = { argumentName: 'P_LOOSE' };

    expect(createParser().prepareRows([sqlObjectRow, looseRow])).toEqual([
      sqlObjectRow,
      looseRow,
    ]);
    expect(createParser().prepareRows([])).toEqual([]);
  });

  // Each message below is part of the public contract: it is what a caller sees
  // when the Oracle dictionary describes something the kit cannot bind. The
  // strings were captured from the pre-extraction OracleAdapter implementation.
  it.each([
    [
      'collection argument, row number embedded',
      [recordRow, fieldRow, { ...recordRow, argumentType: 'TABLE' }],
      'Oracle collection argument at metadata row 3 is not supported',
    ],
    [
      'collection argument detected by type code',
      [{ ...recordRow, argumentType: 'OBJECT', plsqlTypecode: 'COLLECTION' }],
      'Oracle collection argument at metadata row 1 is not supported',
    ],
    [
      'field row without a RECORD parent',
      [scalarRow, fieldRow],
      'Oracle nested argument metadata row 2 has no package RECORD parent',
    ],
    [
      'nested RECORD field',
      [recordRow, { ...fieldRow, dataLevel: 2 }],
      'Oracle nested RECORD fields are not supported (metadata row 2)',
    ],
    [
      'RECORD without field rows',
      [recordRow, fieldRow, recordRow],
      'Oracle package RECORD at prepared metadata row 2 has no fields',
    ],
    [
      '%ROWTYPE argument',
      [{ ...recordRow, typeSubname: 'SHIPS%ROWTYPE' }],
      'Oracle PL/SQL %ROWTYPE arguments are not supported',
    ],
    [
      'unsupported field type',
      [recordRow, { ...fieldRow, argumentType: 'CLOB' }],
      'Oracle RECORD field "NAME" uses unsupported type CLOB',
    ],
    [
      'structured field type',
      [recordRow, { ...fieldRow, typeOwner: 'APP' }],
      'Oracle RECORD field "NAME" uses unsupported type VARCHAR2',
    ],
    [
      'missing dictionary string',
      [{ ...recordRow, typeOwner: null }],
      'Invalid Oracle metadata row 1: typeOwner must be a non-empty string',
    ],
    [
      'blank field name',
      [recordRow, { ...fieldRow, argumentName: '   ' }],
      'Invalid Oracle metadata row 2: argumentName must be a non-empty string',
    ],
    [
      'unparsable dataLevel',
      [{ ...recordRow, dataLevel: 'top' }],
      'Invalid Oracle metadata row 1: dataLevel must be a safe integer greater than or equal to 0',
    ],
    [
      'negative field sequence',
      [recordRow, { ...fieldRow, sequence: -1 }],
      'Invalid Oracle metadata row 2: sequence must be a safe integer greater than or equal to 0',
    ],
    [
      'unsafe RECORD owner',
      [{ ...recordRow, typeOwner: 'AP P' }],
      'Unsafe SQL identifier for oracle record owner: AP P',
    ],
    [
      'unsafe RECORD package',
      [{ ...recordRow, typeName: 'PKG;DROP' }],
      'Unsafe SQL identifier for oracle record package: PKG;DROP',
    ],
    [
      'unsafe RECORD type',
      [{ ...recordRow, typeSubname: '1REC' }],
      'Unsafe SQL identifier for oracle record type: 1REC',
    ],
    [
      'unsafe RECORD field',
      [recordRow, { ...fieldRow, argumentName: 'NA ME' }],
      'Unsafe SQL identifier for oracle record field: NA ME',
    ],
  ])(
    'rejects %s with an unchanged message',
    (_name, rows: Array<Record<string, unknown>>, message): void => {
      expectServerError(
        (): unknown => createParser().prepareRows(rows),
        message
      );
    }
  );

  it('asks the injected version gate once per RECORD argument', (): void => {
    const gate = vi.fn();
    const parser = new OracleRecordMetadataParser(gate);

    parser.prepareRows([scalarRow]);
    expect(gate).not.toHaveBeenCalled();

    parser.prepareRows([
      recordRow,
      fieldRow,
      { ...recordRow, argumentName: 'P_SECOND', order: 2 },
      { ...fieldRow, order: 2 },
    ]);
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('propagates the gate rejection before reading the RECORD type', (): void => {
    const parser = new OracleRecordMetadataParser((): void => {
      throw new ServerError('gate rejected');
    });

    expectServerError(
      (): unknown =>
        parser.prepareRows([{ ...recordRow, typeOwner: null }, fieldRow]),
      'gate rejected'
    );
  });
});

describe('OracleAdapter record version gate', (): void => {
  it('shares one gate between metadata preparation and binding', (): void => {
    const adapter = createOracleAdapter('12.0.0.2.0');
    const structuredType: IProcedureStructuredType = {
      kind: 'oracle-record',
      owner: 'APP',
      packageName: 'PKG',
      typeName: 'RECORD_TYPE',
      fields: [{ name: 'NAME', argumentType: 'VARCHAR2', order: 1 }],
    };
    const message =
      'Oracle PL/SQL RECORD requires Oracle Database 12.1 or newer; detected 12.0.0.2.0';

    expectServerError(
      (): unknown =>
        adapter.prepareProcedureMetadataRows([recordRow, fieldRow]),
      message
    );
    expectServerError(
      (): unknown =>
        adapter.makeBindings(
          'pkg',
          'run',
          {
            run: [
              {
                argumentName: 'p_record',
                argumentType: 'OBJECT',
                order: 1,
                mode: 'IN',
                structuredType,
              },
            ],
          },
          { record: { name: 'Aurora' } }
        ),
      message
    );
  });

  it('reports an unsupported Oracle Client from the metadata path too', (): void => {
    const thinSpy = vi.spyOn(oracledb, 'thin', 'get').mockReturnValue(false);
    const clientVersionSpy = vi
      .spyOn(oracledb, 'oracleClientVersionString', 'get')
      .mockReturnValue('12.0.0.2.0');

    try {
      expectServerError(
        (): unknown =>
          createOracleAdapter().prepareProcedureMetadataRows([
            recordRow,
            fieldRow,
          ]),
        'Oracle PL/SQL RECORD requires Oracle Client 12.1 or newer; detected 12.0.0.2.0'
      );
    } finally {
      clientVersionSpy.mockRestore();
      thinSpy.mockRestore();
    }
  });

  it('accepts RECORD metadata on the 12.1 floor', (): void => {
    expect(
      createOracleAdapter('12.1.0.1.0').prepareProcedureMetadataRows([
        recordRow,
        fieldRow,
      ])
    ).toHaveLength(1);
  });
});
