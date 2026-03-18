import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from '../../types/serializer.types.js';
import { DateFormatter } from '../../utils/date-formatter.js';

export abstract class DatabaseSerializer {
  protected TYPE_SERIALIZER_MAP: TSerializerTypeCastWithoutFormat = new Map();

  public constructor(
    protected readonly logger: ILoggerModule,
    protected readonly options: IRegisteredFetchHandlerOptions
  ) {
    // this.registerFetchHandlerHook(options);
  }

  /**
   * Registers default serializers for the following types: DATE, TIMESTAMP, TIMESTAMP_TZ.
   * The registered serializers will use the following formatting rules:
   * - DATE: 'YYYY-MM-DD'
   * - TIMESTAMP: 'YYYY-MM-DD HH:mm:ss ZZ'
   * - TIMESTAMP_TZ: 'YYYY-MM-DD HH:mm:ss ZZ'
   */

  public registerDefaultSerializers(): void {
    this.setSerializer({
      serializerType: 'DATE',
      strategy: (val: string | Buffer) =>
        DateFormatter.formatDefaultDate(val.toString()),
    });
    this.setSerializer({
      serializerType: 'TIMESTAMP',
      strategy: (val: string | Buffer) =>
        DateFormatter.formatDefaultDateTime(val.toString()),
    });
    this.setSerializer({
      serializerType: 'TIMESTAMP_TZ',
      strategy: (val: string | Buffer) =>
        DateFormatter.formatDefaultDateTimeWithTimezone(val.toString()),
    });
    this.logger.log('Default serializers registered successfully.');
  }
  public abstract registerFetchHandlerHook(
    options: IRegisteredFetchHandlerOptions
  ): void;

  public abstract setSerializer(options: ISetSerializer): void;
  public abstract deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void;
  public abstract deleteAllSerializers(): void;

  public get serializerMapping(): TSerializerTypeCastWithoutFormat {
    return this.TYPE_SERIALIZER_MAP;
  }
}
