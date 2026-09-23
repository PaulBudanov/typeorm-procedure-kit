import { describe, expect, it, vi } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { SerializerBase } from '../../src/core/serializer-base.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

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

  it('serves one read-only registry snapshot from the real adapter chain', (): void => {
    // A real adapter rather than a mock: the read-only guarantee lives in DatabaseSerializer, so a
    // mock handing over an arbitrary Map would only test the mock.
    const adapter = new PostgreAdapter(
      { options: { replication: { master: {} } } } as never,
      createLogger(),
      {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy: {
          transformColumnName: (value: string): string => value.toLowerCase(),
        },
      }
    );
    const serializerBase = new SerializerBase(adapter);
    const strategy = vi.fn((): string => 'date');
    serializerBase.setSerializer({ serializerType: 'DATE', strategy });

    const readOnly = serializerBase.serializerReadOnlyMapping;
    const mutationAttempt = readOnly as unknown as Map<
      TSerializerType,
      TSetSerializer
    >;

    expect(serializerBase.serializerReadOnlyMapping).toBe(readOnly);
    expect(readOnly).toBe(adapter.serializerMapping);
    expect(readOnly.get('DATE')?.strategy).toBe(strategy);
    expect(typeof mutationAttempt.set).toBe('function');
    expect((): void => {
      mutationAttempt.set('TIMESTAMP', {
        serializerType: 'TIMESTAMP',
        strategy: vi.fn(),
      });
    }).toThrow(ServerError);
    expect((): void => {
      mutationAttempt.delete('DATE');
    }).toThrow(ServerError);
    expect(serializerBase.serializerReadOnlyMapping.has('DATE')).toBe(true);
  });
});
