import type oracledb from 'oracledb';
import type { Client, Pool } from 'pg';
import type { OracleConnectionOptions } from 'typeorm/driver/oracle/OracleConnectionOptions.js';
import type { OracleDriver } from 'typeorm/driver/oracle/OracleDriver.js';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';

import type { OracleAdapter } from '../adapters/oracle/oracle-adapter.js';
import type { OracleConnection } from '../adapters/oracle/oracle-connection.js';
import type { OracleNotify } from '../adapters/oracle/oracle-notify.js';
import { OracleSerializer } from '../adapters/oracle/oracle-serializer.js';
import type { PostgreAdapter } from '../adapters/postgres/postgre-adapter.js';
import type { PostgreConnection } from '../adapters/postgres/postgre-connection.js';
import type { PostgreNotify } from '../adapters/postgres/postgre-notify.js';
import { PostgreSerializer } from '../adapters/postgres/postgre-serializer.js';

import type { INativeStrategyMethods } from './strategy.types.js';

// export interface IDatabaseUtils<ClassGeneric extends TDbConfig['type']> {
//   generatePackageInfoSql(packageName: string): string;

//   makeBindings<T extends Record<string, unknown> | Array<unknown>>(
//     packageName: Lowercase<string>,
//     processName: Lowercase<string>,
//     procedures: IProcedureArgumentList | undefined,
//     payload?: T
//   ): IBindingsObjectReturn;

//   makeSqlBindings<U extends Record<string, unknown>>(
//     sqlQuery: string,
//     payload?: U
//   ): ISqlBindingsObjectReturn;

//   sortArgumentsAlgorithm(
//     rawArguments: Array<IProcedureArgumentBase>,
//     procedureListBase: Array<Lowercase<string>>,
//     packageName: Lowercase<string>,
//     packagesLength: number
//   ): IProcedureArgumentList;

//   execute<T>(
//     sql: string,
//     client: EntityManager,
//     optionsCommands: TOptionsCommand[keyof TOptionsCommand],
//     bindings: IBindingsObjectReturn['bindings'],
//     cursorsNames: Array<string>
//   ): Promise<Awaited<Array<T>>>;

//   getPackagesNotifySql(
//     packages: ClassGeneric extends 'oracle' ? Array<string> : undefined
//   ): string;

//   listenNotify<T>(
//     sqlCommand: string,
//     notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
//     options: ClassGeneric extends 'oracle' ? IOracleOptionsNotify : undefined
//   ): Promise<string>;

//   unlistenNotify(channelName: string): Promise<void>;

//   setSerializer(options: ISetSerializer): void;

//   deleteSerializer(
//     serializerType: Pick<ISetSerializer, 'serializerType'>
//   ): void;

//   deleteAllSerializers(): void;

//   getConnectionFromPool(
//     mode?: TConnectionMode
//   ): Promise<ClassGeneric extends 'oracle' ? Connection : PoolClient>;

//   releaseConnectionFromPool(
//     client: ClassGeneric extends 'oracle' ? Connection : PoolClient
//   ): Promise<void> | void;

//   get serializerMapping(): TSerializerTypeCastWithoutFormat;
// }

// export type TOracleAdapterUtils = IDatabaseUtils<'oracle'>;

// export type TPostgreAdapterUtils = IDatabaseUtils<'postgres'>;

// export type TAdapterUtils = TOracleAdapterUtils | TPostgreAdapterUtils;

export interface IRegisteredFetchHandlerOptions {
  caseNativeStrategy: INativeStrategyMethods;
  isNeedRegisterDefaultSerializers: boolean;
}

export type TSerializerClassTypes = OracleSerializer | PostgreSerializer;

export type TNotifyClassTypes = OracleNotify | PostgreNotify;

export type TConnectionClassTypes = OracleConnection | PostgreConnection;

export type TAdapterUtilsClassTypes = OracleAdapter | PostgreAdapter;

export type TPoolTypes = oracledb.Pool | Pool;

export type TConnectionTypes = oracledb.Connection | Client;

export type TTypeOrmDriver = OracleDriver | PostgresDriver;

export type TConnectionOptions =
  | OracleConnectionOptions
  | PostgresConnectionOptions;
