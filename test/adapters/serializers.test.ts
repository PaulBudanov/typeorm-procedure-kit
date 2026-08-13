import oracledb from 'oracledb';
import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import type {
  ISetSerializer,
  TSerializerInput,
  TSerializerType,
} from '../../src/types/serializer.types.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

const caseStrategy = {
  transformColumnName: (value: string): string => value.toLowerCase(),
  destroy: (): void => undefined,
};

function createOracleSerializer(registerDefaults = false): OracleSerializer {
  return new OracleSerializer(createLogger(), {
    isNeedRegisterDefaultSerializers: registerDefaults,
    caseStrategy,
  });
}

function getOracleConverter(
  serializer: OracleSerializer,
  dbType: oracledb.DbType
): ((value: unknown) => unknown) | undefined {
  return serializer.createFetchTypeHandler()({
    name: 'CREATED_AT',
    dbType,
  } as never)?.converter as ((value: unknown) => unknown) | undefined;
}

describe('database serializers', (): void => {
  it('passes discriminated inputs and context to PostgreSQL strategies', (): void => {
    const logger = createLogger();
    const globalDateParser = pgTypes.getTypeParser(pgTypes.builtins.DATE) as (
      value: string
    ) => unknown;
    const serializer = new PostgreSerializer(logger, {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy,
    });
    const strategy = vi.fn(
      (input: TSerializerInput<'DATE'>): string =>
        `${input.serializerType}:${input.value.toString()}:${input.context?.database}`
    );

    serializer.setSerializer({ serializerType: 'DATE', strategy });
    serializer.setSerializer({ serializerType: 'DATE', strategy });

    expect(serializer.serializerMapping.get('DATE')?.strategy).toBe(strategy);
    expect(logger.warn).toHaveBeenCalledWith(
      'Serializer with type DATE already exists, overriding...'
    );
    expect(
      serializer.getTypeOverrides().getTypeParser(pgTypes.builtins.DATE)(
        '2024-01-02'
      )
    ).toBe('DATE:2024-01-02:postgres');
    expect(pgTypes.getTypeParser(pgTypes.builtins.DATE)).toBe(globalDateParser);
    expect(strategy).toHaveBeenCalledWith({
      serializerType: 'DATE',
      value: '2024-01-02',
      context: {
        source: 'fetch',
        database: 'postgres',
        databaseType: String(pgTypes.builtins.DATE),
      },
    });

    serializer.deleteSerializer({ serializerType: 'DATE' });
    expect(serializer.serializerMapping.has('DATE')).toBe(false);
    expect((): void => {
      serializer.setSerializer({
        serializerType: 'WRONG' as never,
        strategy,
      });
    }).toThrow(ServerError);
  });

  it('registers all opt-in PostgreSQL temporal defaults', (): void => {
    const serializer = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: true,
      caseStrategy,
    });
    serializer.registerFetchHandlerHook();

    expect(
      serializer.getTypeOverrides().getTypeParser(pgTypes.builtins.DATE)(
        '2024-01-02'
      )
    ).toBe('2024-01-02 00:00:00');
    expect(
      serializer.getTypeOverrides().getTypeParser(pgTypes.builtins.TIMESTAMP)(
        '2024-01-02 03:04:05.6789'
      )
    ).toBe('2024-01-02 03:04:05.678');
    expect(
      serializer.getTypeOverrides().getTypeParser(pgTypes.builtins.TIMESTAMPTZ)(
        '2024-01-02 03:04:05.678 +03'
      )
    ).toBe('2024-01-02T00:04:05.678Z');
    expect(serializer.serializerMapping.has('TIMESTAMP_LTZ')).toBe(true);

    serializer.deleteAllSerializers();
  });

  it('passes native Oracle Date directly to all temporal defaults', (): void => {
    const serializer = createOracleSerializer(true);
    serializer.registerFetchHandlerHook();
    const localDate = new Date(2024, 0, 2, 3, 4, 5, 678);
    const instant = new Date('2024-01-02T03:04:05.678Z');

    expect(
      getOracleConverter(serializer, oracledb.DB_TYPE_DATE)?.(localDate)
    ).toBe('2024-01-02 03:04:05');
    expect(
      getOracleConverter(serializer, oracledb.DB_TYPE_TIMESTAMP)?.(localDate)
    ).toBe('2024-01-02 03:04:05.678');
    expect(
      getOracleConverter(serializer, oracledb.DB_TYPE_TIMESTAMP_TZ)?.(instant)
    ).toBe('2024-01-02T03:04:05.678Z');
    expect(
      getOracleConverter(serializer, oracledb.DB_TYPE_TIMESTAMP_LTZ)?.(instant)
    ).toBe('2024-01-02T03:04:05.678Z');
    expect(
      getOracleConverter(serializer, oracledb.DB_TYPE_DATE)?.(null)
    ).toBeNull();
    expect(serializer.serializerMapping.has('TIMESTAMP_LTZ')).toBe(true);
  });

  it('serializes scalar OUT values through the public contract', (): void => {
    const serializer = createOracleSerializer();
    const strategy = vi.fn(
      (input: TSerializerInput<'TIMESTAMP_TZ'>): string =>
        `${input.value instanceof Date}:${input.context?.source}`
    );
    const value = new Date('2024-01-02T03:04:05.678Z');
    serializer.setSerializer({ serializerType: 'TIMESTAMP_TZ', strategy });

    expect(
      serializer.serializeValue('TIMESTAMP_TZ', value, {
        source: 'scalar-out',
        database: 'oracle',
        name: 'out_created_at',
      })
    ).toBe('true:scalar-out');
    expect(strategy.mock.calls[0]?.[0].value).toBe(value);

    serializer.deleteSerializer({ serializerType: 'TIMESTAMP_TZ' });
    expect(serializer.serializeValue('TIMESTAMP_TZ', value)).toBe(value);
  });

  it('rejects invalid temporal values and unzoned zoned strings', (): void => {
    const serializer = createOracleSerializer(true);
    serializer.registerFetchHandlerHook();

    expect(() =>
      getOracleConverter(
        serializer,
        oracledb.DB_TYPE_DATE
      )?.(new Date(Number.NaN))
    ).toThrow('Invalid Date value for DATE');
    expect(() =>
      serializer.serializeValue('TIMESTAMP_TZ', '2024-01-02 03:04:05')
    ).toThrow('must end in Z or a numeric UTC offset');
    expect(() =>
      serializer.serializeValue('DATE', '2024-02-31 03:04:05')
    ).toThrow(ServerError);
  });

  it('does not JSON stringify native Oracle JSON objects', (): void => {
    const serializer = createOracleSerializer();
    const strategy = vi.fn(
      (input: TSerializerInput<'JSON'>): unknown => input.value
    );
    const value = { createdAt: '2024-01-02T03:04:05.678Z' };
    serializer.setSerializer({ serializerType: 'JSON', strategy });
    serializer.registerFetchHandlerHook();

    expect(getOracleConverter(serializer, oracledb.DB_TYPE_JSON)?.(value)).toBe(
      value
    );
    expect(strategy.mock.calls[0]?.[0].value).toBe(value);

    serializer.deleteAllSerializers();
    expect(serializer.serializerMapping.size).toBe(0);
  });

  it('accepts only declared JSON-native shapes at the raw DB boundary', (): void => {
    const serializer = createOracleSerializer();
    const strategy = vi.fn(
      (input: TSerializerInput<'JSON'>): unknown => input.value
    );
    serializer.setSerializer({ serializerType: 'JSON', strategy });

    const acceptedValues: Array<unknown> = [
      'json',
      Buffer.from('{}'),
      42,
      true,
      ['nested'],
      { nested: true },
    ];
    acceptedValues.forEach((value) => {
      expect(serializer.serializeValue('JSON', value)).toBe(value);
    });

    class JsonLookalike {
      public readonly nested = true;
    }

    const rejectedValues: Array<unknown> = [
      new Date(),
      new Map(),
      new Set(),
      new JsonLookalike(),
      new ArrayBuffer(1),
    ];
    rejectedValues.forEach((value) => {
      expect(() => serializer.serializeValue('JSON', value)).toThrow(
        'Unsupported native value'
      );
    });
    expect(strategy).toHaveBeenCalledTimes(acceptedValues.length);
  });

  it('returns a detached read-only serializer registry snapshot', (): void => {
    const serializer = createOracleSerializer();
    serializer.setSerializer({
      serializerType: 'DATE',
      strategy: ({ value }) => value,
    });

    const snapshot = serializer.serializerMapping;
    const mutationAttempt = snapshot as unknown as Map<
      TSerializerType,
      ISetSerializer
    >;
    mutationAttempt.clear();

    expect(snapshot.size).toBe(0);
    expect(serializer.serializerMapping.has('DATE')).toBe(true);
  });
});
