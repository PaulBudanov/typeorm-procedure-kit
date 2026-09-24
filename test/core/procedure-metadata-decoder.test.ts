import { describe, expect, it } from 'vitest';

import { ProcedureMetadataDecoder } from '../../src/core/procedure-metadata-decoder.js';
import { ServerError } from '../../src/utils/server-error.js';

function validRow(
  patch: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    procedureName: 'RUN',
    argumentName: 'P_ID',
    argumentType: 'NUMBER',
    order: 1,
    mode: 'IN',
    ...patch,
  };
}

function structuredRow(
  structuredPatch: Record<string, unknown> = {},
  fields: unknown = [{ name: 'ZIP', argumentType: 'int4', order: 1 }]
): Record<string, unknown> {
  return validRow({
    structuredType: {
      kind: 'postgres-composite',
      typeName: 'address_type',
      fields,
      ...structuredPatch,
    },
  });
}

function field(patch: Record<string, unknown>): Array<Record<string, unknown>> {
  return [{ name: 'ZIP', argumentType: 'int4', order: 1, ...patch }];
}

/** Drops a key so the decoder sees it as absent rather than as `undefined`. */
function without(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

describe('ProcedureMetadataDecoder', (): void => {
  const decoder = new ProcedureMetadataDecoder();

  it('decodes a minimal row', (): void => {
    expect(decoder.decodeProcedureArgument(validRow(), 0)).toEqual({
      procedureName: 'RUN',
      argumentName: 'P_ID',
      argumentType: 'NUMBER',
      order: 1,
      mode: 'IN',
    });
  });

  it('trims strings, coerces numeric strings and normalizes the mode', (): void => {
    expect(
      decoder.decodeProcedureArgument(
        validRow({
          procedureName: '  RUN  ',
          mode: ' in / out ',
          order: '2',
          size: '4096',
          subprogramId: '7',
          specificName: ' run_123 ',
          owner: 'APP',
          overload: '1',
        }),
        0
      )
    ).toEqual({
      procedureName: 'RUN',
      argumentName: 'P_ID',
      argumentType: 'NUMBER',
      order: 2,
      mode: 'IN/OUT',
      size: 4096,
      specificName: 'run_123',
      owner: 'APP',
      subprogramId: 7,
      overload: '1',
    });
  });

  it.each([
    ['IN', 'IN'],
    ['out', 'OUT'],
    ['INOUT', 'IN/OUT'],
    ['IN OUT', 'IN/OUT'],
    ['IN/OUT', 'IN/OUT'],
  ])('maps mode %s to %s', (rawMode, expected): void => {
    expect(
      decoder.decodeProcedureArgument(validRow({ mode: rawMode }), 0)
    ).toMatchObject({ mode: expected });
  });

  it('decodes structured metadata, sorting fields by order', (): void => {
    expect(
      decoder.decodeProcedureArgument(
        structuredRow(
          {
            kind: 'oracle-record',
            typeName: ' address_type ',
            typeOid: '1234',
            owner: 'O',
            schema: 'app',
            packageName: 'pkg',
          },
          [
            { name: 'ZIP', argumentType: 'int4', order: '2', typeOid: 23 },
            { name: 'CITY', argumentType: 'text', order: 1, typeName: 'text' },
          ]
        ),
        0
      )
    ).toMatchObject({
      structuredType: {
        kind: 'oracle-record',
        typeName: 'address_type',
        typeOid: 1234,
        owner: 'O',
        schema: 'app',
        packageName: 'pkg',
        fields: [
          { name: 'CITY', argumentType: 'text', order: 1, typeName: 'text' },
          { name: 'ZIP', argumentType: 'int4', order: 2, typeOid: 23 },
        ],
      },
    });
  });

  it('reports the one-based row number of the failing row', (): void => {
    expect(() =>
      decoder.decodeProcedureArgument(validRow({ mode: 'SIDEWAYS' }), 4)
    ).toThrow('Invalid procedure metadata row 5: unsupported mode SIDEWAYS');
  });

  /**
   * Pins every distinct rejection message the decoder can produce: these strings
   * are what a user sees when their procedure metadata is malformed.
   */
  it.each([
    ['Invalid procedure metadata row 1: expected an object', null],
    ['Invalid procedure metadata row 1: expected an object', [validRow()]],
    [
      'Invalid procedure metadata row 1: procedureName must be a non-empty string',
      without(validRow(), 'procedureName'),
    ],
    [
      'Invalid procedure metadata row 1: argumentName must be a non-empty string',
      validRow({ argumentName: '   ' }),
    ],
    [
      'Invalid procedure metadata row 1: argumentType must be a non-empty string',
      validRow({ argumentType: 42 }),
    ],
    [
      'Invalid procedure metadata row 1: mode must be a non-empty string',
      without(validRow(), 'mode'),
    ],
    [
      'Invalid procedure metadata row 1: unsupported mode SIDEWAYS',
      validRow({ mode: 'SIDEWAYS' }),
    ],
    [
      'Invalid procedure metadata row 1: order must be a non-negative safe integer',
      without(validRow(), 'order'),
    ],
    [
      'Invalid procedure metadata row 1: order must be a non-negative safe integer',
      validRow({ order: '   ' }),
    ],
    [
      'Invalid procedure metadata row 1: order must be a non-negative safe integer',
      validRow({ order: -1 }),
    ],
    [
      'Invalid procedure metadata row 1: size must be a positive safe integer',
      validRow({ size: 0 }),
    ],
    [
      'Invalid procedure metadata row 1: subprogramId must be a positive safe integer',
      validRow({ subprogramId: 1.5 }),
    ],
    [
      'Invalid procedure metadata row 1: specificName must be a non-empty string when provided',
      validRow({ specificName: '' }),
    ],
    [
      'Invalid procedure metadata row 1: owner must be a non-empty string when provided',
      validRow({ owner: 5 }),
    ],
    [
      'Invalid procedure metadata row 1: overload must be a non-empty string when provided',
      validRow({ overload: '  ' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType must be an object when provided',
      validRow({ structuredType: 'address_type' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.kind is unsupported',
      structuredRow({ kind: 'mysql-row' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.typeName is required',
      validRow({
        structuredType: { kind: 'postgres-composite', fields: field({}) },
      }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.typeName must be a non-empty string',
      structuredRow({ typeName: '' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.typeOid must be a non-negative safe integer',
      structuredRow({ typeOid: 'abc' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.owner must be a non-empty string',
      structuredRow({ owner: '' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.schema must be a non-empty string',
      structuredRow({ schema: 7 }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.packageName must be a non-empty string',
      structuredRow({ packageName: '  ' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields must be a non-empty array',
      structuredRow({}, []),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields must be a non-empty array',
      structuredRow({}, { name: 'ZIP' }),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields must have unique names and order',
      structuredRow({}, [
        { name: 'ZIP', argumentType: 'int4', order: 1 },
        { name: 'zip', argumentType: 'int4', order: 2 },
      ]),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields must have unique names and order',
      structuredRow({}, [
        { name: 'ZIP', argumentType: 'int4', order: 1 },
        { name: 'CITY', argumentType: 'text', order: 1 },
      ]),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0] must be an object',
      structuredRow({}, [null]),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].name is required',
      structuredRow({}, [{ argumentType: 'int4', order: 1 }]),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].name must be a non-empty string',
      structuredRow({}, field({ name: '' })),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].argumentType is required',
      structuredRow({}, [{ name: 'ZIP', order: 1 }]),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].argumentType must be a non-empty string',
      structuredRow({}, field({ argumentType: '   ' })),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].order is required',
      structuredRow({}, [{ name: 'ZIP', argumentType: 'int4' }]),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].order must be a non-negative safe integer',
      structuredRow({}, field({ order: -1 })),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].typeOid must be a non-negative safe integer',
      structuredRow({}, field({ typeOid: true })),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].typeName must be a non-empty string',
      structuredRow({}, field({ typeName: '' })),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].owner must be a non-empty string',
      structuredRow({}, field({ owner: '' })),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].schema must be a non-empty string',
      structuredRow({}, field({ schema: 1 })),
    ],
    [
      'Invalid procedure metadata row 1: structuredType.fields[0].packageName must be a non-empty string',
      structuredRow({}, field({ packageName: '  ' })),
    ],
  ])('rejects with "%s"', (message, row): void => {
    expect(() => decoder.decodeProcedureArgument(row, 0)).toThrow(ServerError);
    expect(() => decoder.decodeProcedureArgument(row, 0)).toThrow(message);
  });

  it('bounds structured fields by the metadata row limit', (): void => {
    const limited = new ProcedureMetadataDecoder(2);
    const fields = [
      { name: 'A', argumentType: 'text', order: 1 },
      { name: 'B', argumentType: 'text', order: 2 },
      { name: 'C', argumentType: 'text', order: 3 },
    ];

    expect(() =>
      limited.decodeProcedureArgument(structuredRow({}, fields), 0)
    ).toThrow(
      'Invalid procedure metadata row 1: structuredType.fields exceeds resourceLimits.maxMetadataRows (2)'
    );
    expect(() =>
      decoder.decodeProcedureArgument(structuredRow({}, fields), 0)
    ).not.toThrow();
  });

  it('treats a whitespace-only order as invalid but a blank structured integer as zero', (): void => {
    expect(() =>
      decoder.decodeProcedureArgument(validRow({ order: ' ' }), 0)
    ).toThrow('order must be a non-negative safe integer');
    expect(
      decoder.decodeProcedureArgument(
        structuredRow({ typeOid: '' }, field({ order: '' })),
        0
      )
    ).toMatchObject({
      structuredType: {
        typeOid: 0,
        fields: [expect.objectContaining({ order: 0 })],
      },
    });
  });
});
