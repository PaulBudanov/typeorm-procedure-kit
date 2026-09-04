import type { IExecutionOptions } from './config.types.js';
import type {
  ICreateNotify,
  IOracleOptionsNotify,
} from './notification.types.js';
import type {
  TProcedurePayload,
  TProcedurePayloadInput,
} from './procedure.types.js';
import type { TSetSerializer } from './serializer.types.js';
import type { IProcedureResult } from './utility.types.js';
import type { DataSource } from '../typeorm/data-source/DataSource.js';

export type TCallProcedure = <
  TRow,
  TPayload extends TProcedurePayload = TProcedurePayload,
  TOut extends Record<string, unknown> = Record<string, unknown>,
>(
  executeString: string,
  params?: TProcedurePayloadInput<TPayload>,
  executionOptions?: IExecutionOptions
) => Promise<IProcedureResult<TRow, TOut>>;

export type TCallSql = <T>(
  sql: string,
  params?: Record<string, unknown>,
  executionOptions?: IExecutionOptions
) => Promise<Array<T>>;

export type TGetDataSource = () => DataSource;

export type TMakeNotify = <T>(
  options: ICreateNotify<T>,
  additionalOptions?: IOracleOptionsNotify
) => Promise<string>;

export type TUnlistenNotify = (channel: string) => Promise<void>;

export type TSetSerializerHandler = (serializer: TSetSerializer) => void;

export type TDeleteSerializer = (
  serializerType: Pick<TSetSerializer, 'serializerType'>
) => void;

export type TDeleteAllSerializers = () => void;
