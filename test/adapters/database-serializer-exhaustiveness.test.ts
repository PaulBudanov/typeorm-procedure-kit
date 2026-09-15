import { describe, expect, it, vi } from 'vitest';

import { SERIALIZER_TYPES } from '../../src/adapters/abstract/database-serializer.js';
import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
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

describe('serializer type exhaustiveness', (): void => {
  it('lists every member of TSerializerType exactly once', (): void => {
    const listed = [...SERIALIZER_TYPES];
    const witness = Object.keys(NATIVE_VALUE_SAMPLES);

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...witness].sort());
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
