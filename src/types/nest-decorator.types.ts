import type {
  ICreateNotify,
  IOracleOptionsNotify,
} from './notification.types.js';
import type { ISetSerializer } from './serializer.types.js';

export type TCallProcedure = <T>(
  executeString: string,
  params?: Record<string, unknown> | Array<unknown>,
  options?: Array<string>
) => Promise<Array<T>>;

export type TCallSql = <T>(
  sql: string,
  params?: Record<string, unknown>,
  options?: Array<string>
) => Promise<Array<T>>;

export type TMakeNotify = <T>(
  options: ICreateNotify<T>,
  additionalOptions?: IOracleOptionsNotify
) => Promise<string>;

export type TUnlistenNotify = (channel: string) => Promise<void>;

export type TSetSerializer = (serializer: ISetSerializer) => void;

export type TDeleteSerializer = (
  serializerType: Pick<ISetSerializer, 'serializerType'>
) => void;

export type TDeleteAllSerializers = () => void;
