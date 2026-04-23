import type oracledb from 'oracledb';
import type { Client, PoolClient } from 'pg';

import type { OracleConnection } from '../adapters/oracle/oracle-connection.js';
import type { OracleNotify } from '../adapters/oracle/oracle-notify.js';
import type { OracleSerializer } from '../adapters/oracle/oracle-serializer.js';
import type { PostgreConnection } from '../adapters/postgres/postgre-connection.js';
import type { PostgreNotify } from '../adapters/postgres/postgre-notify.js';
import type { PostgreSerializer } from '../adapters/postgres/postgre-serializer.js';
import type { OracleConnectionOptions } from '../typeorm/driver/oracle/OracleConnectionOptions.js';
import type { OracleDriver } from '../typeorm/driver/oracle/OracleDriver.js';
import type { PostgresConnectionOptions } from '../typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { PostgresDriver } from '../typeorm/driver/postgres/PostgresDriver.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';

import type { TDbConfig } from './config.types.js';
import type {
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
} from './notification.types.js';
import type {
  IProcedureArgumentBase,
  TProcedureArgumentList,
} from './procedure.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from './serializer.types.js';
import type { INativeStrategyMethods } from './strategy.types.js';
import type {
  IBindingsObjectReturn,
  ISqlBindingsObjectReturn,
} from './utility.types.js';

export interface IRegisteredFetchHandlerOptions {
  caseNativeStrategy: INativeStrategyMethods;
  isNeedRegisterDefaultSerializers: boolean;
}

export type TSerializerClassTypes = OracleSerializer | PostgreSerializer;

export type TNotifyClassTypes = OracleNotify | PostgreNotify;

export type TConnectionClassTypes = OracleConnection | PostgreConnection;

export interface IDatabaseAdapterContract {
  sortArgumentsAlgorithm(
    rawArguments: Array<IProcedureArgumentBase>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number
  ): TProcedureArgumentList;
  execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: Array<string>,
    bindings?: IBindingsObjectReturn['bindings'],
    cursorsNames?: Array<string>
  ): Promise<Awaited<Array<T>>>;
  generatePackageInfoSql(packageName: string): string;
  makeSqlBindings<U extends Record<string, unknown>>(
    sqlQuery: string,
    params?: U
  ): ISqlBindingsObjectReturn;
  makeBindings<U extends Record<string, unknown> | Array<unknown>>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: U
  ): IBindingsObjectReturn;
  setSerializer(options: ISetSerializer): void;
  deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void;
  deleteAllSerializers(): void;
  readonly serializerMapping: TSerializerTypeCastWithoutFormat;
  listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: IOracleOptionsNotify
  ): Promise<string>;
  unlistenNotify(channelName: string): Promise<void>;
  destroyNotifications(): Promise<void>;
  getNotificationPool(): Map<string, unknown>;
  getPackagesNotifySql(packages?: Array<string>): string;
  getDefaultPackageNotifyOptions?(
    config: TDbConfig
  ): IOracleOptionsNotify | undefined;
  registerFetchHandlerHook(): void;
}

export type TAdapterUtilsClassTypes = IDatabaseAdapterContract;

export type TPoolTypes = oracledb.Pool | PoolClient;

export type TConnectionTypes = oracledb.Connection | Client;

export type TTypeOrmDriver = OracleDriver | PostgresDriver;

export type TConnectionOptions =
  | OracleConnectionOptions
  | PostgresConnectionOptions;
