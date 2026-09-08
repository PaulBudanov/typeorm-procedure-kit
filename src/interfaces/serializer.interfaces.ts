import type {
  TJsonSerializerValue,
  TSerializerStrategy,
  TSerializerType,
} from '../types/serializer.types.js';

export interface ISerializerContext {
  /** Runtime path which supplied the value to the serializer. */
  source?: 'fetch' | 'scalar-out' | 'manual';
  /** Database vendor which supplied the value, when known. */
  database?: 'oracle' | 'postgres';
  /** Result column or output-bind name, when known. */
  name?: string;
  /** Native database type name, when known. */
  databaseType?: string;
}

/** Native runtime values accepted by each serializer type. */
export interface ISerializerNativeValueMap {
  DATE: string | Date;
  TIMESTAMP: string | Date;
  TIMESTAMP_TZ: string | Date;
  TIMESTAMP_LTZ: string | Date;
  BOOLEAN: string | boolean;
  CHAR: string | Buffer;
  VARCHAR: string | Buffer;
  JSON: TJsonSerializerValue;
  BINARY: string | Buffer | ArrayBuffer;
  XML: string | Buffer;
}

/** Serializer strategy for one raw database value type. */
export interface ISerializerValues<
  T extends TSerializerType = TSerializerType,
> {
  strategy: TSerializerStrategy<T>;
}
