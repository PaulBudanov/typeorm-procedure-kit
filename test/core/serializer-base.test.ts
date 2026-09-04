import { describe, expect, it, vi } from 'vitest';

import { SerializerBase } from '../../src/core/serializer-base.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock } from '../support/helpers.js';

import type {
  TSerializerInput,
  TSerializerType,
  TSetSerializer,
} from '../../src/types/serializer.types.js';

describe('SerializerBase', (): void => {
  it('delegates serializer mutations to the adapter', (): void => {
    const adapter = createAdapterMock();
    const serializerBase = new SerializerBase(adapter);
    const strategy = (input: TSerializerInput<'DATE'>): string =>
      input.value.toString();

    serializerBase.setSerializer({ serializerType: 'DATE', strategy });
    serializerBase.deleteSerializer({ serializerType: 'DATE' });
    serializerBase.deleteAllSerializers();

    expect(adapter.setSerializer).toHaveBeenCalledWith({
      serializerType: 'DATE',
      strategy,
    });
    expect(adapter.deleteSerializer).toHaveBeenCalledWith({
      serializerType: 'DATE',
    });
    expect(adapter.deleteAllSerializers).toHaveBeenCalledOnce();
  });

  it('exposes read-only serializer mapping', (): void => {
    const mapping = new Map();
    mapping.set('DATE', { serializerType: 'DATE', strategy: vi.fn() });
    const serializerBase = new SerializerBase(
      createAdapterMock({ serializerMapping: mapping })
    );
    const readOnly = serializerBase.serializerReadOnlyMapping;
    const mutationAttempt = readOnly as unknown as Map<
      TSerializerType,
      TSetSerializer
    >;

    expect(readOnly.get('DATE')).toBe(mapping.get('DATE'));
    expect((): void => {
      mutationAttempt.set('TIMESTAMP', {
        serializerType: 'TIMESTAMP',
        strategy: vi.fn(),
      });
    }).toThrow(ServerError);
    expect((): void => {
      mutationAttempt.delete('DATE');
    }).toThrow(ServerError);
  });
});
