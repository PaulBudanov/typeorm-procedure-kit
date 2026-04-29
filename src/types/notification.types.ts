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
 * Oracle Continuous Query Notification options.
 */
export interface IOracleOptionsNotify {
  operations?: Array<number> | number; // CQN OPCODES, for all: oracledb.CQN_OPCODE_ALL_OPS
  qos?: number;
  timeout?: number;
  clientInitiated?: boolean;
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

export interface INotifyOracleDefaultSettings {
  notifyPort?: number;
  isNeedClientNotificationInit?: boolean;
}
