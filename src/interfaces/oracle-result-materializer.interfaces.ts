import type { ISerializerContext } from './serializer.interfaces.js';
import type { TSerializerType } from '../types/serializer.types.js';

export interface IOracleValueSerializer {
  serializeValue(
    serializerType: TSerializerType,
    value: unknown,
    context?: ISerializerContext
  ): unknown;
}
