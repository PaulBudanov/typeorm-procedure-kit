import { DateFormatter } from '../../utils/date-formatter.js';
import { ServerError } from '../../utils/server-error.js';

import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  ISerializerContext,
  ISetSerializer,
  TSerializerNativeValue,
  TSerializerRegistry,
  TSerializerType,
  TSerializerTypeCastWithoutFormat,
} from '../../types/serializer.types.js';

export abstract class DatabaseSerializer {
  private static readonly TYPE_SERIALIZER_REGISTRY: TSerializerRegistry = {};

  public constructor(
    protected readonly logger: ILoggerModule,
    protected readonly options: IRegisteredFetchHandlerOptions
  ) {}

  /**
   * Registers the opt-in v3 temporal serializers:
   * - DATE: `yyyy-MM-dd HH:mm:ss`
   * - TIMESTAMP: `yyyy-MM-dd HH:mm:ss.SSS`
   * - TIMESTAMP_TZ: UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`
   * - TIMESTAMP_LTZ: UTC `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`
   */
  public registerDefaultSerializers(): void {
    this.setSerializer({
      serializerType: 'DATE',
      strategy: ({ value }) => DateFormatter.formatDefaultDate(value),
    });
    this.setSerializer({
      serializerType: 'TIMESTAMP',
      strategy: ({ value }) => DateFormatter.formatDefaultDateTime(value),
    });
    this.setSerializer({
      serializerType: 'TIMESTAMP_TZ',
      strategy: ({ value }) =>
        DateFormatter.formatDefaultDateTimeWithTimezone(value),
    });
    this.setSerializer({
      serializerType: 'TIMESTAMP_LTZ',
      strategy: ({ value }) =>
        DateFormatter.formatDefaultDateTimeWithLocalTimezone(value),
    });
    this.logger.log('Default serializers registered successfully.');
  }

  /**
   * Applies a registered serializer to a native fetch or scalar OUT value.
   * Nullish database values are normalized to null and bypass the strategy.
   * Values are returned unchanged when no serializer is registered.
   */
  public serializeValue(
    serializerType: TSerializerType,
    value: unknown,
    context?: ISerializerContext
  ): unknown {
    if (value === null || value === undefined) return null;

    switch (serializerType) {
      case 'DATE': {
        const serializer = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.DATE;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'TIMESTAMP': {
        const serializer =
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'TIMESTAMP_TZ': {
        const serializer =
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_TZ;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'TIMESTAMP_LTZ': {
        const serializer =
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_LTZ;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'BOOLEAN': {
        const serializer = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BOOLEAN;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'CHAR': {
        const serializer = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.CHAR;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'VARCHAR': {
        const serializer = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.VARCHAR;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'JSON': {
        const serializer = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.JSON;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'BINARY': {
        const serializer = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BINARY;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'XML': {
        const serializer = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.XML;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
    }
  }

  public abstract registerFetchHandlerHook(
    options?: IRegisteredFetchHandlerOptions
  ): void;

  public abstract setSerializer(options: ISetSerializer): void;
  public abstract deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void;
  public abstract deleteAllSerializers(): void;

  public get serializerMapping(): TSerializerTypeCastWithoutFormat {
    const snapshot = new Map<TSerializerType, ISetSerializer>();
    const registry = DatabaseSerializer.TYPE_SERIALIZER_REGISTRY;

    if (registry.DATE) snapshot.set('DATE', registry.DATE);
    if (registry.TIMESTAMP) snapshot.set('TIMESTAMP', registry.TIMESTAMP);
    if (registry.TIMESTAMP_TZ)
      snapshot.set('TIMESTAMP_TZ', registry.TIMESTAMP_TZ);
    if (registry.TIMESTAMP_LTZ)
      snapshot.set('TIMESTAMP_LTZ', registry.TIMESTAMP_LTZ);
    if (registry.BOOLEAN) snapshot.set('BOOLEAN', registry.BOOLEAN);
    if (registry.CHAR) snapshot.set('CHAR', registry.CHAR);
    if (registry.VARCHAR) snapshot.set('VARCHAR', registry.VARCHAR);
    if (registry.JSON) snapshot.set('JSON', registry.JSON);
    if (registry.BINARY) snapshot.set('BINARY', registry.BINARY);
    if (registry.XML) snapshot.set('XML', registry.XML);

    return snapshot;
  }

  protected hasSerializer(serializerType: TSerializerType): boolean {
    switch (serializerType) {
      case 'DATE':
        return DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.DATE !== undefined;
      case 'TIMESTAMP':
        return (
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP !== undefined
        );
      case 'TIMESTAMP_TZ':
        return (
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_TZ !== undefined
        );
      case 'TIMESTAMP_LTZ':
        return (
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_LTZ !==
          undefined
        );
      case 'BOOLEAN':
        return (
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BOOLEAN !== undefined
        );
      case 'CHAR':
        return DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.CHAR !== undefined;
      case 'VARCHAR':
        return (
          DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.VARCHAR !== undefined
        );
      case 'JSON':
        return DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.JSON !== undefined;
      case 'BINARY':
        return DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BINARY !== undefined;
      case 'XML':
        return DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.XML !== undefined;
    }
  }

  protected registerSerializer(options: ISetSerializer): void {
    switch (options.serializerType) {
      case 'DATE':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.DATE = options;
        return;
      case 'TIMESTAMP':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP = options;
        return;
      case 'TIMESTAMP_TZ':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_TZ = options;
        return;
      case 'TIMESTAMP_LTZ':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_LTZ = options;
        return;
      case 'BOOLEAN':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BOOLEAN = options;
        return;
      case 'CHAR':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.CHAR = options;
        return;
      case 'VARCHAR':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.VARCHAR = options;
        return;
      case 'JSON':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.JSON = options;
        return;
      case 'BINARY':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BINARY = options;
        return;
      case 'XML':
        DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.XML = options;
    }
  }

  protected unregisterSerializer(serializerType: TSerializerType): void {
    switch (serializerType) {
      case 'DATE':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.DATE;
        return;
      case 'TIMESTAMP':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP;
        return;
      case 'TIMESTAMP_TZ':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_TZ;
        return;
      case 'TIMESTAMP_LTZ':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.TIMESTAMP_LTZ;
        return;
      case 'BOOLEAN':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BOOLEAN;
        return;
      case 'CHAR':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.CHAR;
        return;
      case 'VARCHAR':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.VARCHAR;
        return;
      case 'JSON':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.JSON;
        return;
      case 'BINARY':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.BINARY;
        return;
      case 'XML':
        delete DatabaseSerializer.TYPE_SERIALIZER_REGISTRY.XML;
    }
  }

  protected clearSerializerRegistry(): void {
    this.unregisterSerializer('DATE');
    this.unregisterSerializer('TIMESTAMP');
    this.unregisterSerializer('TIMESTAMP_TZ');
    this.unregisterSerializer('TIMESTAMP_LTZ');
    this.unregisterSerializer('BOOLEAN');
    this.unregisterSerializer('CHAR');
    this.unregisterSerializer('VARCHAR');
    this.unregisterSerializer('JSON');
    this.unregisterSerializer('BINARY');
    this.unregisterSerializer('XML');
  }

  protected get registeredSerializerTypes(): ReadonlyArray<TSerializerType> {
    const registeredTypes: Array<TSerializerType> = [];
    if (this.hasSerializer('DATE')) registeredTypes.push('DATE');
    if (this.hasSerializer('TIMESTAMP')) registeredTypes.push('TIMESTAMP');
    if (this.hasSerializer('TIMESTAMP_TZ'))
      registeredTypes.push('TIMESTAMP_TZ');
    if (this.hasSerializer('TIMESTAMP_LTZ'))
      registeredTypes.push('TIMESTAMP_LTZ');
    if (this.hasSerializer('BOOLEAN')) registeredTypes.push('BOOLEAN');
    if (this.hasSerializer('CHAR')) registeredTypes.push('CHAR');
    if (this.hasSerializer('VARCHAR')) registeredTypes.push('VARCHAR');
    if (this.hasSerializer('JSON')) registeredTypes.push('JSON');
    if (this.hasSerializer('BINARY')) registeredTypes.push('BINARY');
    if (this.hasSerializer('XML')) registeredTypes.push('XML');
    return registeredTypes;
  }

  private assertNativeValue<T extends TSerializerType>(
    serializerType: T,
    value: unknown
  ): asserts value is TSerializerNativeValue<T> {
    if (
      serializerType === 'DATE' ||
      serializerType === 'TIMESTAMP' ||
      serializerType === 'TIMESTAMP_TZ' ||
      serializerType === 'TIMESTAMP_LTZ'
    ) {
      if (!(typeof value === 'string' || value instanceof Date)) {
        this.throwUnsupportedNativeValue(serializerType, value);
      }
      if (typeof value === 'string') {
        DateFormatter.parseSqlDate(value, {
          requireZone:
            serializerType === 'TIMESTAMP_TZ' ||
            serializerType === 'TIMESTAMP_LTZ',
        });
      } else if (!DateFormatter.isValid(value)) {
        throw new ServerError(`Invalid Date value for ${serializerType}`);
      }
      return;
    }

    switch (serializerType) {
      case 'BOOLEAN':
        if (typeof value === 'string' || typeof value === 'boolean') return;
        break;
      case 'CHAR':
      case 'VARCHAR':
      case 'XML':
        if (typeof value === 'string' || Buffer.isBuffer(value)) return;
        break;
      case 'BINARY':
        if (
          typeof value === 'string' ||
          Buffer.isBuffer(value) ||
          value instanceof ArrayBuffer
        )
          return;
        break;
      case 'JSON':
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          Buffer.isBuffer(value) ||
          Array.isArray(value) ||
          this.isPlainRecord(value)
        )
          return;
        break;
    }

    this.throwUnsupportedNativeValue(serializerType, value);
  }

  private isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  private throwUnsupportedNativeValue(
    serializerType: TSerializerType,
    value: unknown
  ): never {
    const nativeType = value?.constructor?.name ?? typeof value;
    throw new ServerError(
      `Unsupported native value ${nativeType} for serializer ${serializerType}`
    );
  }
}
