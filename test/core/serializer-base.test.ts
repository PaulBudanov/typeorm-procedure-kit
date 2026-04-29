import { describe, expect, it, vi } from 'vitest';

import { SerializerBase } from '../../src/core/serializer-base.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock } from '../support/helpers.js';

describe('SerializerBase', (): void => {
  it('delegates serializer mutations to the adapter', (): void => {
    const adapter = createAdapterMock();
    const serializerBase = new SerializerBase(adapter);
    const strategy = (value: string | Buffer): string => value.toString();

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
    mapping.set('DATE', { strategy: vi.fn() });
    const serializerBase = new SerializerBase(
      createAdapterMock({ serializerMapping: mapping })
    );
    const readOnly = serializerBase.serializerReadOnlyMapping;

    expect(readOnly.get('DATE')).toBe(mapping.get('DATE'));
    expect((): void => {
      readOnly.set('TIMESTAMP', { strategy: vi.fn() });
    }).toThrow(ServerError);
    expect((): void => {
      readOnly.delete('DATE');
    }).toThrow(ServerError);
  });
});
