import type { IResourceLimits } from './config.interfaces.js';
import type { INotifyRetryOptions } from './notification.interfaces.js';
import type { IProcedureArgumentBase } from './procedure.interfaces.js';
import type { IColumnNameTransformStrategy } from './strategy.interfaces.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
  IProcedureResult,
  ISqlBindingsObjectReturn,
} from './utility.interfaces.js';
import type { EntityManager } from '../typeorm/entity-manager/EntityManager.js';
import type { TNotifyCallbackGeneric } from '../types/notification.types.js';
import type {
  TProcedureArgumentList,
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../types/procedure.types.js';
import type {
  TSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../types/serializer.types.js';

export interface IRegisteredFetchHandlerOptions {
  caseStrategy: IColumnNameTransformStrategy;
  isNeedRegisterDefaultSerializers: boolean;
  resourceLimits?: Readonly<IResourceLimits>;
}

export interface IDatabaseAdapterContract<
  TNotifyOptions extends INotifyRetryOptions = INotifyRetryOptions,
> {
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
  executeProcedure<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    sql: string,
    client: EntityManager,
    optionsCommands: Array<string>,
    bindings?: IBindingsObjectReturn['bindings'],
    cursorsNames?: Array<string>,
    outBindings?: Array<IProcedureOutBinding>
  ): Promise<IProcedureResult<TRow, TOut>>;
  generatePackageInfoSql(
    packageName: string,
    procedureMetadataSql?: string
  ): string;
  prepareProcedureMetadataRows(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>>;
  makeSqlBindings(
    sqlQuery: string,
    params?: Record<string, unknown>
  ): ISqlBindingsObjectReturn;
  makeBindings<U extends TProcedurePayload = TProcedurePayload>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: TProcedurePayloadInput<U>
  ): IBindingsObjectReturn;
  setSerializer(options: TSetSerializer): void;
  deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void;
  deleteAllSerializers(): void;
  readonly serializerMapping: TSerializerTypeCastWithoutFormat;
  listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: TNotifyOptions
  ): Promise<string>;
  unlistenNotify(channelName: string): Promise<void>;
  destroyNotifications(): Promise<void>;
  getNotificationPool(): Map<string, unknown>;
  getPackagesNotifySql(packages?: Array<string>): string;
  registerFetchHandlerHook(): void;
}
