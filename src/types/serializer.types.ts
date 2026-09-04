import type {
  ISerializerContext,
  ISerializerNativeValueMap,
  ISerializerValues,
} from '../interfaces/serializer.interfaces.js';
import type { DbType } from 'oracledb';

export type {
  ISerializerContext,
  ISerializerNativeValueMap,
  ISerializerValues,
} from '../interfaces/serializer.interfaces.js';

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

export type TJsonSerializerValue =
  | string
  | Buffer
  | number
  | boolean
  | Record<string, unknown>
  | ReadonlyArray<unknown>;

export type TSerializerNativeValue<T extends TSerializerType> =
  ISerializerNativeValueMap[T];

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

export type TSetSerializer<T extends TSerializerType = TSerializerType> =
  T extends TSerializerType
    ? ISerializerValues<T> & {
        serializerType: T;
      }
    : never;

export type TSerializerRegistry = {
  [T in TSerializerType]?: TSetSerializer<T>;
};

export type TSerializerTypeCastWithoutFormat = ReadonlyMap<
  TSerializerType,
  TSetSerializer
>;

export type TOracleObjectDbTypeHandlerCast = Map<DbType, TSerializerType>;
