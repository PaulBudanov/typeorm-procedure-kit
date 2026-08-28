import type {
  INotifyRetryOptions,
  TNotifyCallbackGeneric,
} from '../../types/notification.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from '../../types/serializer.types.js';

/** Serializer operations required by the public adapter facade. */
export interface IAdapterSerializerCapability {
  setSerializer(options: ISetSerializer): void;
  deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
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
