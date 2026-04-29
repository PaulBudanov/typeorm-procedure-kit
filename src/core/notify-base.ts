import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { TDbConfig } from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type {
  ICreateNotify,
  IOracleOptionsNotify,
  TNotifyPackageCallback,
} from '../types/notification.types.js';
import { QueueManager } from '../utils/queue-manager.js';

import type { ProcedureListBase } from './procedure-list-base.js';

export class NotifyBase {
  private queueManager = new QueueManager<string>('packageUpdateSet', 'set');
  private queueCallback: ((data: { item: string }) => void) | null = null;

  /**
   * Creates the package notification coordinator.
   *
   * The coordinator receives database package-change events, deduplicates them
   * through an internal queue, and asks ProcedureListBase to refresh procedure
   * metadata for configured packages.
   *
   * @param databaseAdapter - Adapter used to create and manage database notifications.
   * @param procedureListBase - Procedure metadata registry to refresh after package changes.
   * @param logger - Logger used for queue and notification lifecycle messages.
   * @param packagesSettings - Optional package settings that limit refreshes to known packages.
   */
  public constructor(
    private readonly databaseAdapter: TAdapterUtilsClassTypes,
    private readonly procedureListBase: ProcedureListBase,
    private readonly logger: ILoggerModule,
    private readonly packagesSettings?: TDbConfig['packagesSettings']
  ) {
    // Subscribe to queue and get packages from it
    this.queueCallback = (data: { item: string }): void => {
      if (typeof data.item === 'string') {
        void this.procedureListBase.fetchProcedureListWithArguments(
          data.item.toLowerCase() as Lowercase<string>
        );
        this.queueManager.dequeue(data.item);
      }
    };
    this.queueManager.subscribeToEnqueue(this.queueCallback);
  }

  /**
   * Gracefully shuts down all notification subscriptions and queue manager
   * @returns {Promise<void>} - resolves when all cleanup is completed
   */
  public async destroy(): Promise<void> {
    // Destroy notification subscriptions through database adapter
    await this.databaseAdapter.destroyNotifications();

    // Clear queue manager
    this.queueManager.clear();
    this.logger.log('QueueManager cleared');

    this.logger.log('NotifyBase shutdown completed');
  }

  /**
   * Returns the notification pool for external management
   * @returns {Map<string, unknown>} - the notification pool map
   */
  public getNotificationPool(): Map<string, unknown> {
    return this.databaseAdapter.getNotificationPool();
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
  public packageNotifyCallback(notifyData: TNotifyPackageCallback): void {
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
   * Creates a database notification subscription.
   *
   * PostgreSQL expects a `LISTEN channel_name` command. Oracle expects a CQN
   * subscription SQL query and optional CQN settings such as operations, QoS,
   * timeout, or client-initiated mode.
   *
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
