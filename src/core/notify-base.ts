import { QueueManager } from '@web-mis/queue-manager';

import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { TDbConfig } from '../types/config.types.js';
import type {
  ICreateNotify,
  INotifyPackageCallback,
  IOracleOptionsNotify,
} from '../types/notification.types.js';

import type { ProcedureListBase } from './procedure-list-base.js';

export class NotifyBase {
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
  public constructor(
    private readonly databaseAdapter: TAdapterUtilsClassTypes,
    private readonly procedureListBase: ProcedureListBase,
    private readonly packagesSettings?: TDbConfig['packagesSettings']
  ) {
    // Subscribe to queue and get packages from it
    this.queueManager.subscribeToEnqueue((data) => {
      if (typeof data.item === 'string') {
        void this.procedureListBase.fetchProcedureListWithArguments(
          data.item.toLowerCase() as Lowercase<string>
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
  public packageNotifyCallback(notifyData: INotifyPackageCallback): void {
    const processPackage = (packageNameRaw: string): void => {
      const packageName = packageNameRaw.toLowerCase() as Lowercase<string>;
      if (
        this.packagesSettings &&
        this.packagesSettings.packages.includes(packageName)
      ) {
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
   * Create a notification channel and subscribe to it.
   * @param {ICreateNotify<T>} options - options for creating the notification channel
   * @param {IOracleOptionsNotify} [additionalOptions] - additional options for Oracle database, if applicable
   * @returns {Promise<string>} - promise that resolves with the name of the notification channel
   * @example
   * const channelName = await db.createNotification(
   *   {
   *     sql: 'LISTEN my_channel',
   *     notifyCallback: (data) => console.log(data),
   *   }
   * );
   */
  //TODO: Extend to support other databases, refactor interfaces
  public createNotification<T>(
    options: ICreateNotify<T>,
    additionalOptions?: IOracleOptionsNotify
  ): Promise<string> {
    return this.databaseAdapter.listenNotify<T>(
      options.sql,
      options.notifyCallback,
      additionalOptions
    );
  }

  /**
   * Unsubscribe from database notification
   * @param {string} channel - name of notification channel
   * @returns {Promise<void>} - promise that resolves when unsubscribing is completed
   */
  public unlistenNotification(channel: string): Promise<void> {
    return this.databaseAdapter.unlistenNotify(channel);
  }
}
