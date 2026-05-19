import type oracledb from 'oracledb';
import type { Client, PoolClient } from 'pg';

import type { OracleConnection } from '../adapters/oracle/oracle-connection.js';
import type { OracleNotify } from '../adapters/oracle/oracle-notify.js';
import type { OracleSerializer } from '../adapters/oracle/oracle-serializer.js';
import type { PostgreConnection } from '../adapters/postgres/postgre-connection.js';
import type { PostgreNotify } from '../adapters/postgres/postgre-notify.js';
import type { PostgreSerializer } from '../adapters/postgres/postgre-serializer.js';
import type { OracleConnectionOptions } from '../typeorm/driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';

import type {
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from './notification.types.js';
import type {
  IProcedureArgumentBase,
  TProcedureArgumentList,
  TProcedurePayload,
  TProcedurePayloadInput,
} from './procedure.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from './serializer.types.js';
import type { IColumnNameTransformStrategy } from './strategy.types.js';
import type {
  IBindingsObjectReturn,
  ISqlBindingsObjectReturn,
} from './utility.types.js';

export interface IRegisteredFetchHandlerOptions {
  /**
   * Strategy used by driver fetch hooks to transform raw column names and aliases.
   */
  caseStrategy: IColumnNameTransformStrategy;
  /**
   * Whether adapter initialization should register built-in date/time serializers.
   */
  isNeedRegisterDefaultSerializers: boolean;
}

export type TSerializerClassTypes = OracleSerializer | PostgreSerializer;

export type TNotifyClassTypes = OracleNotify | PostgreNotify;

export type TConnectionClassTypes = OracleConnection | PostgreConnection;

export interface IDatabaseAdapterContract<
  TNotifyOptions extends INotifyRetryOptions = INotifyRetryOptions,
> {
  /**
   * Normalizes and sorts raw database procedure arguments.
   */
  sortArgumentsAlgorithm(
    rawArguments: Array<IProcedureArgumentBase>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number
  ): TProcedureArgumentList;
  /**
   * Executes SQL or a procedure call inside a transaction.
   */
  execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: Array<string>,
    bindings?: IBindingsObjectReturn['bindings'],
    cursorsNames?: Array<string>
  ): Promise<Awaited<Array<T>>>;
  /**
   * Builds vendor-specific SQL for loading procedure metadata.
   */
  generatePackageInfoSql(packageName: string): string;
  /**
   * Converts named SQL placeholders to vendor-specific binding format.
   */
  makeSqlBindings<U extends Record<string, unknown>>(
    sqlQuery: string,
    params?: U
  ): ISqlBindingsObjectReturn;
  /**
   * Builds vendor-specific procedure call SQL and bindings.
   */
  makeBindings<U extends TProcedurePayload = TProcedurePayload>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: TProcedurePayloadInput<U>
  ): IBindingsObjectReturn;
  /**
   * Registers or replaces a result serializer.
   */
  setSerializer(options: ISetSerializer): void;
  /**
   * Removes one result serializer.
   */
  deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void;
  /**
   * Removes all result serializers.
   */
  deleteAllSerializers(): void;
  /**
   * Current mutable serializer registry.
   */
  readonly serializerMapping: TSerializerTypeCastWithoutFormat;
  /**
   * Registers a database notification subscription.
   */
  listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: TNotifyOptions
  ): Promise<string>;
  /**
   * Unregisters a database notification subscription.
   */
  unlistenNotify(channelName: string): Promise<void>;
  /**
   * Closes all active notification subscriptions.
   */
  destroyNotifications(): Promise<void>;
  /**
   * Returns the active notification pool for diagnostics.
   */
  getNotificationPool(): Map<string, unknown>;
  /**
   * Builds SQL used for package metadata change notifications.
   */
  getPackagesNotifySql(packages?: Array<string>): string;
  /**
   * Registers driver fetch hooks used by serializers.
   */
  registerFetchHandlerHook(): void;
}

export type TAdapterUtilsClassTypes = IDatabaseAdapterContract;

export type TPoolTypes = oracledb.Pool | PoolClient;

export type TConnectionTypes = oracledb.Connection | Client;

export type TConnectionOptions =
  | OracleConnectionOptions
  | PostgresConnectionOptions;
