import type {
  Connection,
  DbType,
  SubscriptionMessage,
  SubscriptionTable,
} from "oracledb";
import type { PoolClient, types } from "pg";
import type { EntityManager } from "typeorm";

import type { CamelCaseNativeStrategy } from "./case-strategy/native-strategy/camel-case-native-strategy.js";
import type { LowerCaseNativeStrategy } from "./case-strategy/native-strategy/lower-case-native-strategy.js";
import type { CamelCaseNamingStrategy } from "./case-strategy/orm-strategy/camel-case-naming-strategy.js";
import type { LowerCaseNamingStrategy } from "./case-strategy/orm-strategy/lower-case-naming-strategy.js";
//TODO Move interfaces to another files.
export interface TDbConfig {
  type: "oracle" | "postgres";
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  dbPackages: Array<Lowercase<string>> | never;
  poolSize: number;
  appName: string;
  isNeedRegisterDefaultSerializers: boolean; // register default serializers
  cqn_port: number; // port for CQN, added for support old oracle database
  outKeyTransformCase?: TKeyTransformCase; // transform param name case.
  libraryPath?: string;
  callTimeout?: number;
}
export interface IEntityOptions {
  isNeedEntitySync: boolean;
  entityPath: string;
}
export interface IMigrationOptions {
  isNeedMigrationStart: boolean;
  migrationPath: string;
}

export interface TOptionsCommand {
  postgres: Array<string>;
  oracle: Array<string>;
}
export interface IProcedureArgumentOracle extends IProcedureArgumentPostgre {
  packageName: Lowercase<string>;
}
export interface IProcedureArgumentPostgre {
  procedureName: string;
  argumentName: string;
  argumentType: string;
  order: number;
  mode: string;
}
export type IProcedureArgumentList = Record<
  Lowercase<string>,
  Array<Omit<IProcedureArgumentOracle, "package_name" | "procedure_name">>
>;
export type TDBMapStructure = Map<Lowercase<string>, IProcedureArgumentList>;

export interface ICreateNotify<T> {
  sql: string;
  notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>;
  options: IOracleOptionsNotify; // only for oracle
}
export type TNotifyCallbackGeneric<T> = T extends string | object
  ? T
  : Array<T>;
export interface ICreateNotifyOptionsPublic<T> {
  oracle: ICreateNotify<T>;
  postgres: Omit<ICreateNotify<T>, "options">;
}
export interface IOracleOptionsNotify {
  operations?: Array<number> | number; // CQN OPCODES, for all  oracledb.CQN_OPCODE_ALL_OPS,,
  qos?: number;
  timeout?: number;
}

export interface ISqlError {
  error_code?: number;
  err_code?: number;
  err_text?: string;
  error_text?: string;
}

export type INotifyPackageCallback =
  | Array<INotifyPackageCallbackOracle>
  | INotifyPackageCallbackPostgre;

interface INotifyPackageCallbackOracle {
  keyid: number;
  owner: string;
  name: string;
  type: string;
  dat: Date;
  action: string;
  current_user: string;
  os_user: string;
  terminal: string;
  ip_address: string;
  program: string;
  obj_info: string | null;
}
interface INotifyPackageCallbackPostgre {
  event?: string;
  object: string;
}

export interface IBindingsObjectReturn {
  paramExecuteString: string;
  bindings: Array<unknown>;
  cursorsNames: Array<string>;
}

export interface ISqlBindingsObjectReturn extends Pick<
  IBindingsObjectReturn,
  "bindings"
> {
  sqlString: string;
}

export interface ILoggerModule {
  /**
   * Write a 'error' level log.
   */
  error<T>(message: T, stack?: string, context?: string): void;
  error<T>(message: T, ...optionalParams: [...[], string?, string?]): void;
  /**
   * Write a 'log' level log.
   */

  log<T>(message: T, context?: string): void;
  log<T>(message: T, ...optionalParams: [...[], string?]): void;
  /**
   * Write a 'warn' level log.
   */
  warn<T>(message: T, context?: string): void;
  warn<T>(message: T, ...optionalParams: [...[], string?]): void;
  /**
   * Write a 'debug' level log.
   */
  debug<T>(message: T, context?: string): void;
  debug<T>(message: T, ...optionalParams: [...[], string?]): void;

  /**
   * Write a 'verbose' level log.
   */
  verbose<T>(message: T, context?: string): void;
  verbose<T>(message: T, ...optionalParams: [...[], string?]): void;
}
export interface IOracleNotifyMsg extends SubscriptionMessage {
  tables?: Array<SubscriptionTable>;
}
export interface IDataBaseUtils<ClassGeneric extends TDbConfig["type"]> {
  generatePackageInfoSql(packageName: string): string;
  getNotifySql(
    packages: ClassGeneric extends "oracle" ? Array<string> : undefined,
  ): string;

  makeBindings<T extends Record<string, unknown> | Array<unknown>>(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: IProcedureArgumentList | undefined,
    payload?: T,
  ): IBindingsObjectReturn;

  makeSqlBindings<U extends Record<string, unknown>>(
    sqlQuery: string,
    payload?: U,
  ): ISqlBindingsObjectReturn;

  sortArgumentsAlgorithm(
    rawArguments: ClassGeneric extends "oracle"
      ? Array<IProcedureArgumentOracle>
      : Array<IProcedureArgumentPostgre>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number,
  ): IProcedureArgumentList;

  execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: TOptionsCommand[keyof TOptionsCommand],
    bindings: IBindingsObjectReturn["bindings"],
    cursorsNames: Array<string>,
  ): Promise<Awaited<Array<T>>>;

  listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options: ClassGeneric extends "oracle" ? IOracleOptionsNotify : undefined,
  ): Promise<string>;

  unlistenNotify(channelName: string): Promise<void>;

  setSerializer(options: TSetSerializer): void;
  deleteSerializer(
    serializerType: Pick<TSetSerializer, "serializerType">,
  ): void;

  deleteAllSerializers(): void;

  registerFetchHandlerHook(options: IRegisteredFetchHandlerOptions): void;

  getConnectionFromPool(
    mode?: TConnectionMode,
  ): Promise<ClassGeneric extends "oracle" ? Connection : PoolClient>;

  releaseConnectionFromPool(
    client: ClassGeneric extends "oracle" ? Connection : PoolClient,
  ): Promise<void> | void;

  get serializerMapping(): ClassGeneric extends "oracle"
    ? TOracleSerializerTypeCastWithoutFormat
    : TPostgreSerializerTypeCastWithoutFormat;
}
export type TOracleUtils = IDataBaseUtils<"oracle">;
export type TPostgresUtils = IDataBaseUtils<"postgres">;

// ? Возможно стоит расширить список для пг и оракла отдельно, но сейчас не требуется
// type TSerializerTypeWithFormatBase = 'DATE' | 'TIMESTAMP' | 'TIMESTAMP_TZ';

// ? Возможно стоит расширить список для пг и оракла отдельно, но сейчас не требуется
type TSerializerTypeWithoutFormatBase =
  | "DATE"
  | "TIMESTAMP"
  | "TIMESTAMP_TZ"
  | "BOOLEAN"
  | "CHAR"
  | "VARCHAR"
  | "JSON"
  | "BINARY"
  | "XML";

// TODO: Добавить автоматическое форматирование строки в зависимости от типа(Date, Timestamp) к нужному формату в будущем.
// TODO: Стоит поправить типизацию.
interface ISerialzerValues<T = unknown> {
  type: T;
  strategy: (param: string | Buffer) => unknown;
  // formatString?: string;
}
export type TOracleSerializerTypeCastWithoutFormat = Map<
  TSerializerTypeWithoutFormatBase,
  ISerialzerValues<DbType>
>;
export type TOracleObjectTypeCast = Record<
  TSerializerTypeWithoutFormatBase,
  DbType
>;

export type TOracleObjectDbTypeHandlerCast = Map<
  DbType,
  TSerializerTypeWithoutFormatBase
>;

export type TPostgreSerializerTypeCastWithoutFormat = Map<
  TSerializerTypeWithoutFormatBase,
  ISerialzerValues<(typeof types.builtins)[keyof typeof types.builtins]>
>;
export type TPostgreObjectTypeCast = Record<
  TSerializerTypeWithoutFormatBase,
  (typeof types.builtins)[keyof typeof types.builtins]
>;

export type TSetSerializer = {
  serializerType: TSerializerTypeWithoutFormatBase;
} & Pick<ISerialzerValues, "strategy">;

export type TConnectionMode = "master" | "slave";

export type TKeyTransformCase = "camelCase" | "lowerCase";
export interface IRegisteredFetchHandlerOptions {
  caseNativeStrategy: INativeStrategyMethods;
  isNeedRegisterDefaultSerializers: boolean;
}

export interface INativeStrategyMethods {
  transformColumnName: (columnName: string) => string;
}
export interface ICaseStratefyFactory {
  strategy: CamelCaseNamingStrategy | LowerCaseNamingStrategy;
  nativeStrategy: CamelCaseNativeStrategy | LowerCaseNativeStrategy;
}
