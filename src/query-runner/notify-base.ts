import { QueueManager } from '@web-mis/queue-manager';

import type {
  ICreateNotify,
  IEntityOptions,
  ILoggerModule,
  IMigrationOptions,
  INotifyPackageCallback,
  TDbConfig,
} from '../types.js';

import { SerializerBase } from './serializer-base.js';
export class NotifyBase extends SerializerBase {
  private queueManager = new QueueManager<string>('packageUpdateSet', 'set');

  /**
   * Constructor for NotifyBase class.
   * It is protected, so it can only be used in derived classes.
   * @param dbConfig - database configuration
   * @param procedureObjectList - list of procedures
   * @param logger - logger
   * @param entity - entity configuration (optional)
   * @param migrationPath - migration configuration (optional)
   */
  protected constructor(
    protected readonly dbConfig: TDbConfig,
    protected readonly procedureObjectList: Record<string, string>,
    protected readonly logger: ILoggerModule,
    protected readonly entity?: IEntityOptions,
    protected readonly migrationPath?: IMigrationOptions,
  ) {
    super(dbConfig, procedureObjectList, logger, entity, migrationPath);
    // Subscribe to queue and get packages from it
    this.queueManager.subscribeToEnqueue((data) => {
      if (typeof data.item === 'string') {
        void this.fetchProcedureListWithArguments(
          data.item.toLowerCase() as Lowercase<string>,
        );
        this.queueManager.dequeue(data.item);
      }
    });
  }

  /**
   * Handle notification data from database
   * @param notifyData - notification data from database
   * @example
   * [
   *   {
   *     event: 'CREATE',
   *     object: 'PACKAGE_NAME',
   *     owner: 'SCHEMA_NAME',
   *   },
   * ]
   * OR
   * {
   *   event: 'DROP',
   *   object: 'PACKAGE_NAME',
   *   owner: 'SCHEMA_NAME',
   * }
   * @returns void
   */
  protected packageNotifyCallback(notifyData: INotifyPackageCallback): void {
    const processPackage = (packageNameRaw: string) => {
      const packageName = packageNameRaw.toLowerCase() as Lowercase<string>;
      if (this.dbConfig.dbPackages.includes(packageName)) {
        this.queueManager.enqueue(undefined, packageName);
      }
    };

    if (Array.isArray(notifyData)) {
      notifyData.forEach((item) => processPackage(item.name));
    } else {
      if (
        notifyData.event &&
        (notifyData.event.toUpperCase() === 'DROP' ||
          notifyData.event.toUpperCase() === 'CREATE')
      )
        processPackage(notifyData.object);
    }
    return;
  }
  /**
   * Create notification in database
   * @param {ICreateNotify<T> | Omit<ICreateNotify<T>, 'options'>} options - options for notification
   * @returns {Promise<string>} - name of notification
   * @example
   * const notifyName = await dataBase.createNotification<T>({
   *   sql: 'SELECT rowid FROM TABLE_NAME',
   *   notifyCallback: (args) => console.log(args),
   *   options: {
   *     operations: oracledb.CQN_OPCODE_ALL_OPS,
   *     qos: oracledb.SUBSCR_QOS_ROWIDS,
   *   },
   * });
   */
  protected createNotification<T>(
    options: ICreateNotify<T> | Omit<ICreateNotify<T>, 'options'>,
  ): Promise<string> {
    return this.dbUtilsInstance.listenNotify<T>(
      options.sql,
      options.notifyCallback,
      'options' in options ? options.options : undefined,
    );
  }

  /**
   * Unsubscribe from database notification
   * @param {string} channel - name of notification channel
   * @returns {Promise<void>} - promise that resolves when unsubscribing is completed
   */
  protected unlistenNotification(channel: string): Promise<void> {
    return this.dbUtilsInstance.unlistenNotify(channel);
  }
}
