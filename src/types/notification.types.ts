import type {
  INotifyPackageCallbackOracle,
  INotifyPackageCallbackPostgre,
  IOracleOptionsNotify,
} from '../interfaces/notification.interfaces.js';

export type {
  ICreateNotify,
  INotifyHealthCheckOptions,
  INotifyPackageCallbackOracle,
  INotifyPackageCallbackPostgre,
  INotifyRestoreOptions,
  INotifyRetryOptions,
  IOracleNotifyMsg,
  IOracleNotifyRestoreSettings,
  IOracleOptionsNotify,
  IPostgreNotifyRestoreSettings,
  IRestoreState,
} from '../interfaces/notification.interfaces.js';

export type TNotifyCallbackGeneric<T> = T extends string | object
  ? T
  : Array<T>;

export type TOracleNormilizeOptionsNotify = Omit<
  IOracleOptionsNotify,
  'operations'
> & {
  operations?: number;
};

export type TNotifyPackageCallback =
  | Array<INotifyPackageCallbackOracle>
  | INotifyPackageCallbackPostgre;
