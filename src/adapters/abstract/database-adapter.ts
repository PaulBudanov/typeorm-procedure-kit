import oracledb from 'oracledb';
import type { PoolClient } from 'pg';
import type { EntityManager } from 'typeorm';

import type {
  TConnectionClassTypes,
  TNotifyClassTypes,
  TSerializerClassTypes,
} from '../../types/adapter.types.js';
import type { TConnectionMode } from '../../types/config.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  IOracleOptionsNotify,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';
import type {
  IProcedureArgumentBase,
  IProcedureArgumentList,
} from '../../types/procedure.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from '../../types/serializer.types.js';
import type {
  IBindingsObjectReturn,
  ISqlBindingsObjectReturn,
} from '../../types/utility.types.js';
import { DatabaseOptionsExecutor } from '../../utils/database-options-executor.js';

export abstract class DatabaseAdapter<
  T extends TSerializerClassTypes,
  U extends TNotifyClassTypes,
  V extends TConnectionClassTypes,
> {
  /**
   * Constructor for DatabaseAdapter
   * @param logger - logger module to use for logging
   * @param serializer - serializer object to use for serializing and deserializing data
   * @param notifier - notifier object to use for sending and receiving notifications
   * @param connection - database connection object to use for executing queries and procedures
   */
  public constructor(
    protected readonly logger: ILoggerModule,
    protected readonly serializer: T,
    protected readonly notifier: U,
    protected readonly connection: V
  ) {}
  /**
   * Sorts the arguments for a given procedure in a package.
   * Removes any procedures that are not present in the procedureListBase array.
   * If the package does not exist in the procedureListBase array and there are multiple packages,
   * the procedure is skipped.
   * Sorts the arguments by their position.
   * @param rawArguments - array of raw arguments for the procedure
   * @param procedureListBase - array of procedures in the package
   * @param packageName - name of the package
   * @param packagesLength - length of the packages array
   * @returns sorted arguments for the procedure
   */
  public sortArgumentsAlgorithm(
    rawArguments: Array<IProcedureArgumentBase>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number
  ): IProcedureArgumentList {
    const sortedProcedures = rawArguments.reduce(
      (acc: IProcedureArgumentList, item: IProcedureArgumentBase) => {
        const itemObjectNameToLowerCase =
          item.procedureName.toLowerCase() as Lowercase<string>;
        if (
          item.argumentName === undefined ||
          item.argumentName === null ||
          (!procedureListBase.includes(
            `${packageName}.${itemObjectNameToLowerCase}` as Lowercase<string>
          ) &&
            packagesLength > 1)
        )
          return acc;
        acc[itemObjectNameToLowerCase] = acc[itemObjectNameToLowerCase] ?? [];
        acc[itemObjectNameToLowerCase].push({
          argumentName: item.argumentName.toLowerCase(),
          argumentType: item.argumentType,
          order: item.order,
          mode: item.mode,
        });
        acc[itemObjectNameToLowerCase].sort((a, b) => a.order - b.order);

        return acc;
      },
      {} as IProcedureArgumentList
    );
    return sortedProcedures;
  }

  /**
   * Execute a SQL query or procedure call in a transaction
   * @param {string} sql - SQL query string
   * @param {EntityManager} client - database connection
   * @param { Array<string>} optionsCommands - options for database commands
   * @param {IBindingsObjectReturn['bindings']} [bindings] - parameters for SQL query
   * @param {Array<string>} [cursorsNames] - names of cursors
   * @returns {Promise<Awaited<Array<T>>>} - result of SQL query call
   */
  public async execute<T>(
    sql: string,
    client: EntityManager,
    optionsCommands: Array<string>,
    bindings: IBindingsObjectReturn['bindings'] = [],
    cursorsNames: Array<string> = []
  ): Promise<Awaited<Array<T>>> {
    return client.transaction(async (manager) => {
      if (optionsCommands && optionsCommands.length > 0) {
        await DatabaseOptionsExecutor.executeCommands(
          optionsCommands,
          manager,
          this.logger
        );
      }
      const result = await manager.query<Array<T | oracledb.ResultSet<T>>>(
        sql,
        bindings
      );
      const isCursorResult =
        Array.isArray(result) &&
        result.length > 0 &&
        typeof result[0] === 'object' &&
        result !== null &&
        cursorsNames.length > 0;
      if (isCursorResult) {
        return this.fetchAllCursors<T>(cursorsNames, result, manager);
      }
      return result as Array<T>;
    });
  }

  public abstract generatePackageInfoSql(packageName: string): string;

  public abstract makeSqlBindings<U extends Record<string, unknown>>(
    sqlQuery: string,
    params?: U
  ): ISqlBindingsObjectReturn;

  public abstract makeBindings<
    U extends Record<string, unknown> | Array<unknown>,
  >(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: IProcedureArgumentList | undefined,
    payload?: U
  ): IBindingsObjectReturn;

  protected abstract fetchAllCursors<T>(
    cursorNames: Array<string>,
    result?: Array<oracledb.ResultSet<T> | T>,
    manager?: EntityManager
  ): Promise<Array<T>>;

  public setSerializer(options: ISetSerializer): void {
    this.serializer.setSerializer(options);
  }

  public deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void {
    this.serializer.deleteSerializer(serializerType);
  }

  public deleteAllSerializers(): void {
    this.serializer.deleteAllSerializers();
  }
  public abstract getConnectionFromPool(
    mode?: TConnectionMode
  ): Promise<oracledb.Connection | PoolClient>;
  public abstract releaseConnectionFromPool(
    client: oracledb.Connection & PoolClient
  ): Promise<void> | void;
  public get serializerMapping(): TSerializerTypeCastWithoutFormat {
    return this.serializer.serializerMapping;
  }

  public listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void,
    options?: IOracleOptionsNotify
  ): Promise<string> {
    return this.notifier.listenNotify<T>(
      sqlCommand,
      notifyCallback,
      options ?? {}
    );
  }

  public unlistenNotify(channelName: string): Promise<void> {
    return this.notifier.unlistenNotify(channelName, false);
  }

  public getPackagesNotifySql(packages?: Array<string>): string {
    return this.notifier.getPackagesNotifySql(packages ?? []);
  }
}
