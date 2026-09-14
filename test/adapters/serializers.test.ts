import oracledb from 'oracledb';
import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

import type {
  TSerializerInput,
  TSerializerType,
  TSetSerializer,
} from '../../src/types/serializer.types.js';

const caseStrategy = {
  transformColumnName: (value: string): string => value.toLowerCase(),
  destroy: (): void => undefined,
};

function createOracleSerializer(
  shouldRegisterDefaults = false
): OracleSerializer {
  return new OracleSerializer(createLogger(), {
    isNeedRegisterDefaultSerializers: shouldRegisterDefaults,
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
  it('isolates registrations and deletion across database instances', (): void => {
    const first = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy,
    });
    const second = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy,
    });
    const oracle = createOracleSerializer();
    first.setSerializer({ serializerType: 'VARCHAR', strategy: () => 'first' });
    second.setSerializer({
      serializerType: 'VARCHAR',
      strategy: () => 'second',
    });
    oracle.setSerializer({
      serializerType: 'VARCHAR',
      strategy: () => 'oracle',
    });

    const firstParser = first
      .getTypeOverrides()
      .getTypeParser(pgTypes.builtins.VARCHAR);
    const secondParser = second
      .getTypeOverrides()
      .getTypeParser(pgTypes.builtins.VARCHAR);
    expect(firstParser('value')).toBe('first');
    expect(secondParser('value')).toBe('second');
    expect(
      getOracleConverter(oracle, oracledb.DB_TYPE_VARCHAR)?.('value')
    ).toBe('oracle');

    second.deleteSerializer({ serializerType: 'VARCHAR' });
    oracle.deleteAllSerializers();
    expect(firstParser('value')).toBe('first');
    expect(first.serializerMapping.has('VARCHAR')).toBe(true);
    expect(second.serializerMapping.size).toBe(0);
    expect(oracle.serializerMapping.size).toBe(0);
  });

  it.each(['single', 'all'] as const)(
    'applies JSON strategies to JSON and JSONB and restores both after %s deletion',
    (deletion): void => {
      const serializer = new PostgreSerializer(createLogger(), {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy,
      });
      const strategy = vi.fn(() => 'custom-json');
      serializer.setSerializer({ serializerType: 'JSON', strategy });
      for (const oid of [pgTypes.builtins.JSON, pgTypes.builtins.JSONB]) {
        expect(
          serializer.getTypeOverrides().getTypeParser(oid)('{"value":1}')
        ).toBe('custom-json');
        expect(strategy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({ databaseType: String(oid) }),
          })
        );
      }
      if (deletion === 'single')
        serializer.deleteSerializer({ serializerType: 'JSON' });
      else serializer.deleteAllSerializers();
      for (const oid of [pgTypes.builtins.JSON, pgTypes.builtins.JSONB]) {
        expect(serializer.getTypeOverrides().getTypeParser(oid)).toBe(
          pgTypes.getTypeParser(oid)
        );
        expect(
          serializer.getTypeOverrides().getTypeParser(oid)('{"value":1}')
        ).toEqual({ value: 1 });
      }
    }
  );

  it.each(['TIMESTAMP_TZ', 'TIMESTAMP_LTZ'] as const)(
    'preserves the other temporal strategy after deleting %s',
    (deletedType): void => {
      const serializer = new PostgreSerializer(createLogger(), {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy,
      });
      serializer.setSerializer({
        serializerType: 'TIMESTAMP_TZ',
        strategy: () => 'tz',
      });
      serializer.setSerializer({
        serializerType: 'TIMESTAMP_LTZ',
        strategy: () => 'ltz',
      });
      const oid = pgTypes.builtins.TIMESTAMPTZ;
      expect(
        serializer.getTypeOverrides().getTypeParser(oid)('2024-01-02T03:04:05Z')
      ).toBe('ltz');
      serializer.deleteSerializer({ serializerType: deletedType });
      expect(
        serializer.getTypeOverrides().getTypeParser(oid)('2024-01-02T03:04:05Z')
      ).toBe(deletedType === 'TIMESTAMP_TZ' ? 'ltz' : 'tz');
      serializer.deleteSerializer({
        serializerType:
          deletedType === 'TIMESTAMP_TZ' ? 'TIMESTAMP_LTZ' : 'TIMESTAMP_TZ',
      });
      expect(serializer.getTypeOverrides().getTypeParser(oid)).toBe(
        pgTypes.getTypeParser(oid)
      );
    }
  );

  it('rejects transformed column collisions without including values', (): void => {
    const serializer = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy,
    });
    expect(() =>
      serializer.transformRows(
        [{ FOO: 'private-first', foo: 'private-second' }],
        []
      )
    ).toThrow(
      /^PostgreSQL result columns "FOO" and "foo" have conflicting transformed name "foo"$/
    );
  });

  it('reports both source columns for collisions from a custom strategy', (): void => {
    const serializer = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        ...caseStrategy,
        transformColumnName: () => 'merged',
      },
    });
    expect(() =>
      serializer.transformRows(
        [{ left: 'private-first', right: 'private-second' }],
        []
      )
    ).toThrow(
      /^PostgreSQL result columns "left" and "right" have conflicting transformed name "merged"$/
    );
  });

  it('preserves prototype-like result columns as own properties', (): void => {
    const serializer = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy,
    });
    const source = Object.fromEntries([
      ['__proto__', { value: 1 }],
      ['constructor', 'own-value'],
    ]);
    const rows = serializer.transformRows([source], []);
    expect(rows).toStrictEqual([source]);
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
  });

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

  it('preserves PostgreSQL refcursor portal values with transformed keys', (): void => {
    const serializer = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy,
    });

    expect(
      serializer.transformRows(
        [{ OUT_CURSOR: 'portal"name', STATUS: 'ready' }],
        [
          {
            name: 'OUT_CURSOR',
            dataTypeID: pgTypes.builtins.REFCURSOR,
          },
          { name: 'STATUS', dataTypeID: pgTypes.builtins.TEXT },
        ] as never
      )
    ).toEqual([{ out_cursor: 'portal"name', status: 'ready' }]);
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
      TSetSerializer
    >;
    mutationAttempt.clear();

    expect(snapshot.size).toBe(0);
    expect(serializer.serializerMapping.has('DATE')).toBe(true);
  });
});
