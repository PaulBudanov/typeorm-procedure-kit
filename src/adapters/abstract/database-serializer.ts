import { DateFormatter } from '../../utils/date-formatter.js';
import { ServerError } from '../../utils/server-error.js';

import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  ISerializerContext,
  TSerializerNativeValue,
  TSerializerRegistry,
  TSerializerType,
  TSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../../types/serializer.types.js';

export abstract class DatabaseSerializer {
  private readonly serializerRegistry: TSerializerRegistry = {};

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
        const serializer = this.serializerRegistry.DATE;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'TIMESTAMP': {
        const serializer = this.serializerRegistry.TIMESTAMP;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'TIMESTAMP_TZ': {
        const serializer = this.serializerRegistry.TIMESTAMP_TZ;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'TIMESTAMP_LTZ': {
        const serializer = this.serializerRegistry.TIMESTAMP_LTZ;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'BOOLEAN': {
        const serializer = this.serializerRegistry.BOOLEAN;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'CHAR': {
        const serializer = this.serializerRegistry.CHAR;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'VARCHAR': {
        const serializer = this.serializerRegistry.VARCHAR;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'JSON': {
        const serializer = this.serializerRegistry.JSON;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'BINARY': {
        const serializer = this.serializerRegistry.BINARY;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
      case 'XML': {
        const serializer = this.serializerRegistry.XML;
        if (!serializer) return value;
        this.assertNativeValue(serializerType, value);
        return serializer.strategy({ serializerType, value, context });
      }
    }
  }

  public abstract registerFetchHandlerHook(
    options?: IRegisteredFetchHandlerOptions
  ): void;

  public abstract setSerializer(options: TSetSerializer): void;
  public abstract deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void;
  public abstract deleteAllSerializers(): void;

  public get serializerMapping(): TSerializerTypeCastWithoutFormat {
    const snapshot = new Map<TSerializerType, TSetSerializer>();
    const registry = this.serializerRegistry;

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
        return this.serializerRegistry.DATE !== undefined;
      case 'TIMESTAMP':
        return this.serializerRegistry.TIMESTAMP !== undefined;
      case 'TIMESTAMP_TZ':
        return this.serializerRegistry.TIMESTAMP_TZ !== undefined;
      case 'TIMESTAMP_LTZ':
        return this.serializerRegistry.TIMESTAMP_LTZ !== undefined;
      case 'BOOLEAN':
        return this.serializerRegistry.BOOLEAN !== undefined;
      case 'CHAR':
        return this.serializerRegistry.CHAR !== undefined;
      case 'VARCHAR':
        return this.serializerRegistry.VARCHAR !== undefined;
      case 'JSON':
        return this.serializerRegistry.JSON !== undefined;
      case 'BINARY':
        return this.serializerRegistry.BINARY !== undefined;
      case 'XML':
        return this.serializerRegistry.XML !== undefined;
    }
  }

  protected registerSerializer(options: TSetSerializer): void {
    switch (options.serializerType) {
      case 'DATE':
        this.serializerRegistry.DATE = options;
        return;
      case 'TIMESTAMP':
        this.serializerRegistry.TIMESTAMP = options;
        return;
      case 'TIMESTAMP_TZ':
        this.serializerRegistry.TIMESTAMP_TZ = options;
        return;
      case 'TIMESTAMP_LTZ':
        this.serializerRegistry.TIMESTAMP_LTZ = options;
        return;
      case 'BOOLEAN':
        this.serializerRegistry.BOOLEAN = options;
        return;
      case 'CHAR':
        this.serializerRegistry.CHAR = options;
        return;
      case 'VARCHAR':
        this.serializerRegistry.VARCHAR = options;
        return;
      case 'JSON':
        this.serializerRegistry.JSON = options;
        return;
      case 'BINARY':
        this.serializerRegistry.BINARY = options;
        return;
      case 'XML':
        this.serializerRegistry.XML = options;
    }
  }

  protected unregisterSerializer(serializerType: TSerializerType): void {
    switch (serializerType) {
      case 'DATE':
        delete this.serializerRegistry.DATE;
        return;
      case 'TIMESTAMP':
        delete this.serializerRegistry.TIMESTAMP;
        return;
      case 'TIMESTAMP_TZ':
        delete this.serializerRegistry.TIMESTAMP_TZ;
        return;
      case 'TIMESTAMP_LTZ':
        delete this.serializerRegistry.TIMESTAMP_LTZ;
        return;
      case 'BOOLEAN':
        delete this.serializerRegistry.BOOLEAN;
        return;
      case 'CHAR':
        delete this.serializerRegistry.CHAR;
        return;
      case 'VARCHAR':
        delete this.serializerRegistry.VARCHAR;
        return;
      case 'JSON':
        delete this.serializerRegistry.JSON;
        return;
      case 'BINARY':
        delete this.serializerRegistry.BINARY;
        return;
      case 'XML':
        delete this.serializerRegistry.XML;
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
