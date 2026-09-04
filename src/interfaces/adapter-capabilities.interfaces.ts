import type { INotifyRetryOptions } from './notification.interfaces.js';
import type { TNotifyCallbackGeneric } from '../types/notification.types.js';
import type {
  TSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../types/serializer.types.js';

/** Serializer operations required by the public adapter facade. */
export interface IAdapterSerializerCapability {
  setSerializer(options: TSetSerializer): void;
  deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void;
  deleteAllSerializers(): void;
  readonly serializerMapping: TSerializerTypeCastWithoutFormat;
  registerFetchHandlerHook(): void;
}

/** Notification operations required by the public adapter facade. */
export interface IAdapterNotificationCapability<
  TOptions extends INotifyRetryOptions,
  TConnection,
> {
  listenNotify<T>(
    sqlCommand: string,
    notifyCallback: (args: TNotifyCallbackGeneric<T>) => void | Promise<void>,
    options?: TOptions
  ): Promise<string>;
  unlistenNotify(channelName: string): Promise<void>;
  destroy(): Promise<void>;
  getNotificationPool(): Map<string, TConnection>;
  getPackagesNotifySql(packages: Array<string>): string;
}
