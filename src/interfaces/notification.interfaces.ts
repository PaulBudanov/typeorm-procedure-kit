import type {
  TNotifyCallbackGeneric,
  TOracleNormilizeOptionsNotify,
} from '../types/notification.types.js';
import type { SubscriptionMessage, SubscriptionTable } from 'oracledb';

/** Database notification subscription input. */
export interface ICreateNotify<T = unknown> {
  sql: string;
  notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>;
}

/** Common retry settings for notification restore. */
export interface INotifyRetryOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  retryAfterMaxDelayMs?: number;
}

export interface INotifyHealthCheckOptions<T> {
  channelName: string;
  connection: T;
  intervalMs: number;
  isHealthy: (connection: T) => Promise<boolean>;
  restore: () => Promise<void>;
}

export interface INotifyRestoreOptions<TSettings> {
  channelName: string;
  settings: TSettings;
  restore: (settings: TSettings) => Promise<void>;
  maxRetries?: number;
  retryDelayMs?: number;
  currentRetry?: number;
  retryAfterMaxDelayMs?: number;
}

export interface IOracleNotifyRestoreSettings<T> {
  sqlCommand: string;
  notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>;
  options: TOracleNormilizeOptionsNotify;
}

export interface IPostgreNotifyRestoreSettings<T> {
  notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>;
  options: INotifyRetryOptions;
}

/** Oracle Continuous Query Notification options. */
export interface IOracleOptionsNotify extends INotifyRetryOptions {
  operations?: Array<number> | number;
  qos?: number;
  timeout?: number;
  clientInitiated?: boolean;
  cqnPort?: number | undefined;
}

export interface IRestoreState {
  isCancelled: boolean;
  isHealthCheckInProgress: boolean;
  activeRestore?: Promise<void>;
  cancelRetryDelay?: () => void;
  healthCheckTimer?: NodeJS.Timeout;
}

export interface IOracleNotifyMsg extends SubscriptionMessage {
  tables?: Array<SubscriptionTable>;
}

/**
 * One row refetched by the Oracle package-change CQN query. Only the package
 * name is read, from the NAME column matched case-insensitively; the default
 * query selects nothing else, so its rows carry just the upper-case `NAME` key.
 * The other members describe further `SOLUTION_ROOT.DB_OBJECT_LOG` columns and
 * are present only when a custom `metadataNotificationSql` selects them.
 */
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

/**
 * PostgreSQL package-change payload: one JSON object sent with NOTIFY on the
 * package channel. Field names are matched case-insensitively and fields other
 * than `object` are ignored.
 */
export interface INotifyPackageCallbackPostgre {
  /**
   * Informational only. Every payload that names a configured package
   * refreshes it; which DDL sends a payload is the trigger's decision.
   */
  event?: string;
  /** Package (schema) whose procedure metadata changed. */
  object: string;
}
