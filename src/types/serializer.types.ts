import type { DbType } from 'oracledb';

type TSerializerTypeWithoutFormatBase =
  | 'DATE'
  | 'TIMESTAMP'
  | 'TIMESTAMP_TZ'
  | 'BOOLEAN'
  | 'CHAR'
  | 'VARCHAR'
  | 'JSON'
  | 'BINARY'
  | 'XML';

/**
 * Serializer strategy for a raw database value.
 */
export interface ISerializerValues {
  strategy: (param: string | Buffer) => unknown;
}

/**
 * @deprecated Use `ISerializerValues` instead.
 */
export type ISerialzerValues = ISerializerValues;

export type TSerializerTypeCastWithoutFormat = Map<
  TSerializerTypeWithoutFormatBase,
  ISerializerValues
>;

/**
 * Registers or overrides a serializer for one supported database type key.
 *
 * Supported keys are `DATE`, `TIMESTAMP`, `TIMESTAMP_TZ`, `BOOLEAN`, `CHAR`,
 * `VARCHAR`, `JSON`, `BINARY`, and `XML`.
 */
export interface ISetSerializer extends ISerializerValues {
  serializerType: TSerializerTypeWithoutFormatBase;
}
export type TOracleObjectDbTypeHandlerCast = Map<
  DbType,
  TSerializerTypeWithoutFormatBase
>;
