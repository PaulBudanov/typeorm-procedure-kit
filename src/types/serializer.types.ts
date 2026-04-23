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

export interface ISetSerializer extends ISerializerValues {
  serializerType: TSerializerTypeWithoutFormatBase;
}
export type TOracleObjectDbTypeHandlerCast = Map<
  DbType,
  TSerializerTypeWithoutFormatBase
>;
