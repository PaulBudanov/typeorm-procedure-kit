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
