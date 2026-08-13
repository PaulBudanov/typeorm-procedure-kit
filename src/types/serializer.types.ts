import type { DbType } from 'oracledb';

export type TSerializerType =
  | 'DATE'
  | 'TIMESTAMP'
  | 'TIMESTAMP_TZ'
  | 'TIMESTAMP_LTZ'
  | 'BOOLEAN'
  | 'CHAR'
  | 'VARCHAR'
  | 'JSON'
  | 'BINARY'
  | 'XML';

export type TTemporalSerializerType =
  | 'DATE'
  | 'TIMESTAMP'
  | 'TIMESTAMP_TZ'
  | 'TIMESTAMP_LTZ';

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

export type TJsonSerializerValue =
  | string
  | Buffer
  | number
  | boolean
  | Record<string, unknown>
  | ReadonlyArray<unknown>;

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

export type TSerializerNativeValue<T extends TSerializerType> =
  ISerializerNativeValueMap[T];

/**
 * Discriminated input passed to a serializer strategy.
 *
 * Switching on `serializerType` narrows `value` to the native values supported
 * by that database type.
 */
export type TSerializerInput<T extends TSerializerType = TSerializerType> =
  T extends TSerializerType
    ? {
        serializerType: T;
        value: TSerializerNativeValue<T>;
        context?: ISerializerContext;
      }
    : never;

export type TSerializerStrategy<T extends TSerializerType = TSerializerType> = (
  input: TSerializerInput<T>
) => unknown;

/** Serializer strategy for one raw database value type. */
export interface ISerializerValues<
  T extends TSerializerType = TSerializerType,
> {
  strategy: TSerializerStrategy<T>;
}

/**
 * @deprecated Use `ISerializerValues` instead.
 */
export type ISerialzerValues<T extends TSerializerType = TSerializerType> =
  ISerializerValues<T>;

/**
 * Registers or overrides a serializer for one supported database type key.
 * The union is discriminated by `serializerType`, which also determines the
 * native value accepted by `strategy`.
 */
export type ISetSerializer<T extends TSerializerType = TSerializerType> =
  T extends TSerializerType
    ? ISerializerValues<T> & {
        serializerType: T;
      }
    : never;

/** Internal registry whose key and strategy input remain correlated. */
export type TSerializerRegistry = {
  [T in TSerializerType]?: ISetSerializer<T>;
};

/** Public, non-mutable snapshot of the registered serializers. */
export type TSerializerTypeCastWithoutFormat = ReadonlyMap<
  TSerializerType,
  ISetSerializer
>;

export type TOracleObjectDbTypeHandlerCast = Map<DbType, TSerializerType>;
