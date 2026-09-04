import type { ISerializerContext } from './serializer.interfaces.js';
import type { TSerializerType } from '../types/serializer.types.js';

export interface IPortalOutput {
  outputName: string;
  portalName: string;
  quotedPortal: string;
}

export interface IPostgreValueSerializer {
  serializeValue(
    serializerType: TSerializerType,
    value: unknown,
    context?: ISerializerContext
  ): unknown;
}
