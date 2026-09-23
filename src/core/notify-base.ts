import type { ProcedureListBase } from './procedure-list-base.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { TDbConfig } from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type {
  ICreateNotify,
  IOracleOptionsNotify,
  TNotifyPackageCallback,
} from '../types/notification.types.js';

export class NotifyBase {
  private readonly activeRefreshes = new Set<Promise<void>>();
  private destroyPromise: Promise<void> | null = null;
  private isDestroyed = false;

  /**
   * Creates the package notification coordinator.
   *
   * The coordinator receives database package-change events and delegates
   * refresh coalescing to ProcedureListBase.
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
  ) {}

  /**
   * Gracefully waits for delegated refreshes and shuts down subscriptions.
   * @returns {Promise<void>} - resolves when all cleanup is completed
   */
  public destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.isDestroyed = true;
    this.destroyPromise = this.destroyInternal();
    return this.destroyPromise;
  }

  private async destroyInternal(): Promise<void> {
    await Promise.allSettled(this.activeRefreshes);
    await this.databaseAdapter.destroyNotifications();
    this.logger.log('NotifyBase shutdown completed');
  }

  private refreshPackage(packageName: Lowercase<string>): Promise<void> {
    if (this.isDestroyed) return Promise.resolve();
    const refresh =
      this.procedureListBase.fetchProcedureListWithArguments(packageName);
    this.activeRefreshes.add(refresh);
    const clear = (): void => {
      this.activeRefreshes.delete(refresh);
    };
    void refresh.then(clear, clear);
    return refresh;
  }

  /**
   * Returns the notification pool for external management
   * @returns {Map<string, unknown>} - the notification pool map
   */
  public getNotificationPool(): Map<string, unknown> {
    return this.databaseAdapter.getNotificationPool();
  }

  /**
   * Refreshes the metadata of every configured package a package-change
   * notification names.
   *
   * Both vendors follow one rule: every notification that names a configured
   * package refreshes it, and which DDL produces a notification is decided in
   * the database - by the CQN query on Oracle, by the trigger on PostgreSQL.
   * An event name in the payload is not interpreted. A notification that names
   * no package is logged and skipped; one that names a package outside
   * `packagesSettings.packages` is skipped silently. Field names are matched
   * case-insensitively.
   *
   * What differs is only the payload each database can deliver: Oracle CQN
   * hands over the changed rows of the watched query, PostgreSQL NOTIFY hands
   * over one text payload.
   * @param notifyData - rows refetched by the Oracle CQN query, or the parsed
   * PostgreSQL NOTIFY payload.
   * @example
   * // Oracle: rows of the CQN query, each naming a package in NAME
   * [{ NAME: 'BILLING' }, { NAME: 'REPORTING' }]
   * // PostgreSQL: one JSON object naming the package (schema) in "object"
   * { event: 'CREATE', object: 'billing' }
   */
  public async packageNotifyCallback(
    notifyData: TNotifyPackageCallback
  ): Promise<void> {
    if (this.isDestroyed) return;

    const configuredPackages = new Set(
      (this.packagesSettings?.packages ?? []).map((packageName) =>
        packageName.toLowerCase()
      )
    );

    const processPackage = async (packageNameRaw: string): Promise<void> => {
      const packageName = packageNameRaw
        .trim()
        .toLowerCase() as Lowercase<string>;
      if (packageName.length > 0 && configuredPackages.has(packageName)) {
        await this.refreshPackage(packageName);
      }
    };

    // This shape test is the one vendor branch left in this class, and it
    // cannot tell a PostgreSQL JSON array from Oracle rows. Each vendor
    // notifier should turn its own payload into package names instead, which
    // needs a package-notification member on the adapter contract.
    if (Array.isArray(notifyData)) {
      await Promise.all(
        notifyData.map(async (item) => {
          const packageName = this.readStringField(item, 'name');
          if (!packageName) {
            this.logger.warn(
              'Ignoring Oracle package notification without a string NAME field'
            );
            return;
          }
          await processPackage(packageName);
        })
      );
      return;
    }
    const packageName = this.readStringField(notifyData, 'object');
    if (!packageName) {
      this.logger.warn(
        'Ignoring PostgreSQL package notification without a string "object" field'
      );
      return;
    }
    await processPackage(packageName);
  }

  /**
   * Starts metadata refresh work without holding the adapter's per-channel
   * notification queue until the database metadata query completes. Bursts are
   * coalesced by ProcedureListBase.
   */
  public schedulePackageNotifyCallback(
    notifyData: TNotifyPackageCallback
  ): void {
    void this.packageNotifyCallback(notifyData).catch((error: unknown) => {
      this.logger.error(
        `Failed to process package notification: ${(error as Error).message}`,
        (error as Error).stack
      );
    });
  }

  private readStringField(value: unknown, fieldName: string): string | null {
    if (value === null || typeof value !== 'object') return null;
    const entry = Object.entries(value).find(
      ([key]) => key.toLowerCase() === fieldName.toLowerCase()
    );
    return typeof entry?.[1] === 'string' ? entry[1] : null;
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
