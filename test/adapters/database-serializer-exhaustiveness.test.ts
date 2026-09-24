import { describe, expect, it, vi } from 'vitest';

import { SERIALIZER_TYPES } from '../../src/adapters/abstract/database-serializer.js';
import { OracleSerializer } from '../../src/adapters/oracle/oracle-serializer.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

import type { TSerializerType } from '../../src/types/serializer.types.js';

/**
 * Runtime witness for `TSerializerType`. The annotation makes the compiler demand one entry per
 * union member, so a new member breaks `typecheck:test` here even before the assertions below
 * compare this key set with `SERIALIZER_TYPES`.
 */
const NATIVE_VALUE_SAMPLES: Record<TSerializerType, unknown> = {
  DATE: new Date('2024-01-02T03:04:05.678Z'),
  TIMESTAMP: new Date('2024-01-02T03:04:05.678Z'),
  TIMESTAMP_TZ: new Date('2024-01-02T03:04:05.678Z'),
  TIMESTAMP_LTZ: new Date('2024-01-02T03:04:05.678Z'),
  BOOLEAN: true,
  CHAR: 'c',
  VARCHAR: 'value',
  JSON: { value: 1 },
  BINARY: Buffer.from('binary'),
  XML: '<root />',
};

const caseStrategy = {
  transformColumnName: (value: string): string => value.toLowerCase(),
  destroy: (): void => undefined,
};

/** Exposes the protected registry views of `DatabaseSerializer` to the assertions below. */
class ProbeSerializer extends PostgreSerializer {
  public get exposedRegisteredSerializerTypes(): ReadonlyArray<TSerializerType> {
    return this.registeredSerializerTypes;
  }

  public exposedHasSerializer(serializerType: TSerializerType): boolean {
    return this.hasSerializer(serializerType);
  }
}

function createProbeSerializer(): ProbeSerializer {
  return new ProbeSerializer(createLogger(), {
    isNeedRegisterDefaultSerializers: false,
    caseStrategy,
  });
}

/** The Oracle counterpart of `ProbeSerializer`: same registry view, other vendor. */
class OracleProbeSerializer extends OracleSerializer {
  public exposedHasSerializer(serializerType: TSerializerType): boolean {
    return this.hasSerializer(serializerType);
  }
}

const VENDOR_PROBES = [
  ['PostgreSQL', createProbeSerializer],
  [
    'Oracle',
    (): OracleProbeSerializer =>
      new OracleProbeSerializer(createLogger(), {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy,
      }),
  ],
] as const;

/**
 * Every own property name of `Object.prototype`, read from the running engine rather than written
 * out. Looking any of these up in an object literal, as in `TABLE[serializerType]`, returns an
 * inherited value instead of `undefined`, so a guard that only asks whether the lookup found
 * something accepts all of them.
 */
const PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype);

/** Strings that look like serializer types but are not members of the union. */
const NEAR_MISSES = ['date', 'Date', 'DATE ', '', 'TIMESTAMPTZ'];

/**
 * Non-string values a caller outside the type system could pass, each with the text the error
 * message must show for it. Some cannot even be turned into a string or a property key without
 * throwing, which must still surface as the same ServerError.
 */
const NON_STRING_TYPES: ReadonlyArray<readonly [unknown, string]> = [
  [42, '42'],
  [null, 'null'],
  [undefined, 'undefined'],
  [Symbol('DATE'), 'Symbol(DATE)'],
  [['DATE'], '[object Array]'],
  [{ toString: (): string => 'DATE' }, '[object Object]'],
  [Object.create(null), '[object Object]'],
];

/**
 * Runs an action once and returns what it threw, so a single call can be checked for both the
 * error class and the exact message.
 * @param action - the call under test.
 * @returns the thrown value, or undefined when the call returned normally.
 */
function captureThrown(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('serializer type exhaustiveness', (): void => {
  it('lists every member of TSerializerType exactly once', (): void => {
    const listed = [...SERIALIZER_TYPES];
    const witness = Object.keys(NATIVE_VALUE_SAMPLES);

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...witness].sort());
  });

  it('keeps the canonical order that serializerMapping exposes to consumers', (): void => {
    // Asserted against a literal, not against SERIALIZER_TYPES: every other
    // assertion in this file derives both sides from that same list, so a
    // reordering of the source of truth would be invisible to all of them.
    // `serializerMapping` is a public getter, so its iteration order is part of
    // the observable contract.
    expect([...SERIALIZER_TYPES]).toEqual([
      'DATE',
      'TIMESTAMP',
      'TIMESTAMP_TZ',
      'TIMESTAMP_LTZ',
      'BOOLEAN',
      'CHAR',
      'VARCHAR',
      'JSON',
      'BINARY',
      'XML',
    ]);
  });

  it('registers, reports and clears every serializer type', (): void => {
    const serializer = createProbeSerializer();
    // Reverse registration order: the registry views must still use the canonical order, which
    // PostgreSerializer.deleteSerializer relies on when it looks for a replacement parser.
    for (const serializerType of [...SERIALIZER_TYPES].reverse()) {
      serializer.setSerializer({
        serializerType,
        strategy: () => `serialized:${serializerType}`,
      });
    }

    expect(serializer.exposedRegisteredSerializerTypes).toEqual([
      ...SERIALIZER_TYPES,
    ]);
    expect([...serializer.serializerMapping.keys()]).toEqual([
      ...SERIALIZER_TYPES,
    ]);
    for (const serializerType of SERIALIZER_TYPES) {
      expect(serializer.exposedHasSerializer(serializerType)).toBe(true);
    }

    serializer.deleteAllSerializers();

    expect(serializer.serializerMapping.size).toBe(0);
    expect(serializer.exposedRegisteredSerializerTypes).toEqual([]);
    for (const serializerType of SERIALIZER_TYPES) {
      expect(serializer.exposedHasSerializer(serializerType)).toBe(false);
    }
  });

  it('dispatches serializeValue to the strategy of every serializer type', (): void => {
    const serializer = createProbeSerializer();
    for (const serializerType of SERIALIZER_TYPES) {
      const strategy = vi.fn(() => `serialized:${serializerType}`);
      serializer.setSerializer({ serializerType, strategy });

      const value = NATIVE_VALUE_SAMPLES[serializerType];
      expect(serializer.serializeValue(serializerType, value)).toBe(
        `serialized:${serializerType}`
      );
      expect(strategy).toHaveBeenCalledWith({
        serializerType,
        value,
        context: undefined,
      });
    }
  });

  it('keeps the registered entry identity in the serializer mapping', (): void => {
    const serializer = createProbeSerializer();
    for (const serializerType of SERIALIZER_TYPES) {
      const options = {
        serializerType,
        strategy: (): string => 'value',
      };
      serializer.setSerializer(options);
      expect(serializer.serializerMapping.get(serializerType)).toBe(options);
    }
  });

  it('returns unserialized values for types without a registered strategy', (): void => {
    const serializer = createProbeSerializer();
    for (const serializerType of SERIALIZER_TYPES) {
      const value = NATIVE_VALUE_SAMPLES[serializerType];
      expect(serializer.serializeValue(serializerType, value)).toBe(value);
      expect(serializer.serializeValue(serializerType, null)).toBeNull();
      expect(serializer.serializeValue(serializerType, undefined)).toBeNull();
    }
  });
});

describe('serializer type membership at the registration boundary', (): void => {
  it.each(VENDOR_PROBES)(
    '%s accepts every member of TSerializerType',
    (_vendor, createSerializer): void => {
      // The accepted set is the compile-time witness, not SERIALIZER_TYPES: the membership check
      // itself reads SERIALIZER_TYPES, so deriving the expectation from it too would pass even
      // if an entry went missing from the list.
      const serializer = createSerializer();
      for (const serializerType of Object.keys(
        NATIVE_VALUE_SAMPLES
      ) as Array<TSerializerType>) {
        serializer.setSerializer({ serializerType, strategy: () => 'value' });
        expect(serializer.exposedHasSerializer(serializerType)).toBe(true);
      }
    }
  );

  it.each(VENDOR_PROBES)(
    '%s rejects Object.prototype keys and near misses without registering them',
    (_vendor, createSerializer): void => {
      for (const serializerType of [...PROTOTYPE_KEYS, ...NEAR_MISSES]) {
        const serializer = createSerializer();
        const thrown = captureThrown((): void => {
          serializer.setSerializer({
            serializerType: serializerType as never,
            strategy: () => 'leaked',
          });
        });

        expect(thrown, serializerType).toBeInstanceOf(ServerError);
        expect((thrown as Error).message).toBe(
          `Unknown serializer type: ${serializerType}`
        );
        expect(
          serializer.exposedHasSerializer(serializerType as never),
          serializerType
        ).toBe(false);
        expect(serializer.serializerMapping.size).toBe(0);
      }
    }
  );

  it.each(VENDOR_PROBES)(
    '%s rejects deleting a type outside the union instead of ignoring it',
    (_vendor, createSerializer): void => {
      const serializer = createSerializer();
      serializer.setSerializer({ serializerType: 'DATE', strategy: () => 'd' });

      for (const serializerType of [...PROTOTYPE_KEYS, ...NEAR_MISSES]) {
        const thrown = captureThrown((): void => {
          serializer.deleteSerializer({
            serializerType: serializerType as never,
          });
        });

        expect(thrown, serializerType).toBeInstanceOf(ServerError);
        expect((thrown as Error).message).toBe(
          `Unknown serializer type: ${serializerType}`
        );
      }
      expect(serializer.exposedHasSerializer('DATE')).toBe(true);
    }
  );

  it.each(VENDOR_PROBES)(
    '%s reports a non-string type as a ServerError on registration and deletion',
    (_vendor, createSerializer): void => {
      for (const [serializerType, printed] of NON_STRING_TYPES) {
        const serializer = createSerializer();
        for (const action of [
          (): void => {
            serializer.setSerializer({
              serializerType: serializerType as never,
              strategy: () => 'leaked',
            });
          },
          (): void => {
            serializer.deleteSerializer({
              serializerType: serializerType as never,
            });
          },
        ]) {
          const thrown = captureThrown(action);
          expect(thrown, printed).toBeInstanceOf(ServerError);
          expect((thrown as Error).message).toBe(
            `Unknown serializer type: ${printed}`
          );
        }
        expect(serializer.serializerMapping.size).toBe(0);
      }
    }
  );
});
