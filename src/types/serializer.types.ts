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

export interface ISerialzerValues {
  strategy: (param: string | Buffer) => unknown;
}

export type TSerializerTypeCastWithoutFormat = Map<
  TSerializerTypeWithoutFormatBase,
  ISerialzerValues
>;

export interface ISetSerializer extends ISerialzerValues {
  serializerType: TSerializerTypeWithoutFormatBase;
}
export type TOracleObjectDbTypeHandlerCast = Map<
  DbType,
  TSerializerTypeWithoutFormatBase
>;
