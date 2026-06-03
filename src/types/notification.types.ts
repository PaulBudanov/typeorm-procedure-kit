import type { SubscriptionMessage, SubscriptionTable } from 'oracledb';

export type TNotifyCallbackGeneric<T> = T extends string | object
  ? T
  : Array<T>;

/**
 * Database notification subscription input.
 *
 * PostgreSQL uses `sql` as a `LISTEN channel` command. Oracle uses it as the
 * Continuous Query Notification subscription query.
 */
export interface ICreateNotify<T = unknown> {
  sql: string;
  notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>;
}

/**
 * Common retry settings for notification restore.
 */
export interface INotifyRetryOptions {
  /**
   * Maximum restore attempts before switching to retryAfterMaxDelayMs.
   */
  maxRetries?: number;
  /**
   * Delay between regular restore attempts in milliseconds.
   */
  retryDelayMs?: number;
  /**
   * Delay after maxRetries are exhausted before the counter restarts.
   */
  retryAfterMaxDelayMs?: number;
}

export interface INotifyHealthCheckOptions<T> {
  /**
   * Channel or subscription name being monitored.
   */
  channelName: string;
  /**
   * Dedicated notification connection.
   */
  connection: T;
  /**
   * Health-check interval in milliseconds.
   */
  intervalMs: number;
  /**
   * Returns whether the connection is still usable.
   */
  isHealthy: (connection: T) => Promise<boolean>;
  /**
   * Restores the subscription when the health check fails.
   */
  restore: () => Promise<void>;
}

export interface INotifyRestoreOptions<TSettings> {
  /**
   * Channel or subscription name being restored.
   */
  channelName: string;
  /**
   * Adapter-specific restore state.
   */
  settings: TSettings;
  /**
   * Adapter-specific restore callback.
   */
  restore: (settings: TSettings) => Promise<void>;
  maxRetries?: number;
  retryDelayMs?: number;
  /**
   * Initial retry counter.
   */
  currentRetry?: number;
  retryAfterMaxDelayMs?: number;
}

export interface IOracleNotifyRestoreSettings<T> {
  /**
   * Original CQN subscription query.
   */
  sqlCommand: string;
  /**
   * Callback to reattach to the restored subscription.
   */
  notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>;
  /**
   * Normalized CQN and restore retry options.
   */
  options: TOracleNormilizeOptionsNotify;
}

export interface IPostgreNotifyRestoreSettings<T> {
  /**
   * Callback to reattach to the restored LISTEN subscription.
   */
  notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>;
  /**
   * Restore retry options.
   */
  options: INotifyRetryOptions;
}

/**
 * Oracle Continuous Query Notification options.
 */
export interface IOracleOptionsNotify extends INotifyRetryOptions {
  /**
   * Oracle CQN opcode or opcodes. Use oracledb.CQN_OPCODE_ALL_OPS for all operations.
   */
  operations?: Array<number> | number;
  /**
   * Oracle CQN QoS flags.
   */
  qos?: number;
  /**
   * Oracle CQN subscription timeout in seconds.
   */
  timeout?: number;

  /**
   * Enables client-initiated CQN mode.
   *
   */
  clientInitiated?: boolean;

  /**
   * Legacy server-initiated CQN callback port.
   * Use only with `clientInitiated: false`.
   */
  cqnPort?: number | undefined;
}

export interface IRestoreState {
  isCancelled: boolean;
  isHealthCheckInProgress: boolean;
  activeRestore?: Promise<void>;
  cancelRetryDelay?: () => void;
  healthCheckTimer?: NodeJS.Timeout;
}

export type TOracleNormilizeOptionsNotify = Omit<
  IOracleOptionsNotify,
  'operations'
> & {
  operations?: number;
};

export type TNotifyPackageCallback =
  | Array<INotifyPackageCallbackOracle>
  | INotifyPackageCallbackPostgre;

export interface IOracleNotifyMsg extends SubscriptionMessage {
  tables?: Array<SubscriptionTable>;
}

export interface INotifyPackageCallbackOracle {
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

export interface INotifyPackageCallbackPostgre {
  event?: string;
  object: string;
}
