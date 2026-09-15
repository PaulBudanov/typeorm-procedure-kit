import { DateFormatter } from '../../utils/date-formatter.js';
import { ServerError } from '../../utils/server-error.js';

import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  ISerializerContext,
  TSerializerNativeValue,
  TSerializerType,
  TSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../../types/serializer.types.js';

/**
 * Identity helper which makes `SERIALIZER_TYPES` the single source of truth for
 * `TSerializerType`.
 *
 * The constraint rejects a listed value which is not a serializer type. The intersected
 * `Record` rejects the opposite mistake — a union member the list does not contain — because it
 * then demands a property named after that member, so the compiler error names it; when the list
 * is complete the record has no keys and the intersection is a no-op. Both halves are needed:
 * `satisfies` alone would only prove that everything listed is valid, never that everything valid
 * is listed.
 */
const listAllSerializerTypes = <
  const TList extends ReadonlyArray<TSerializerType>,
>(
  list: TList & Record<Exclude<TSerializerType, TList[number]>, never>
): TList => list;

/**
 * Every member of `TSerializerType`, in the canonical order used by `serializerMapping` and
 * `registeredSerializerTypes`. Module-internal on purpose: it is not re-exported by any barrel.
 */
export const SERIALIZER_TYPES = listAllSerializerTypes([
  'DATE',
  'TIMESTAMP',
  'TIMESTAMP_TZ',
  'TIMESTAMP_LTZ',
  'BOOLEAN',
  'CHAR',
  'VARCHAR',
  'JSON',
  'BINARY',
  'XML',
]);

export abstract class DatabaseSerializer {
  private readonly serializerRegistry = new Map<
    TSerializerType,
    TSetSerializer
  >();

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

    const serializer = this.serializerRegistry.get(serializerType);
    if (!serializer) return value;
    this.assertNativeValue(serializerType, value);

    // The single cast in this module. `TSetSerializer` is distributive, so an entry read back
    // through a `TSerializerType` variable carries a *union* of per-type strategies, and a union
    // of function types cannot be called with a union argument. `assertNativeValue` above is what
    // makes the widened call correct at runtime: it proves `value` matches `serializerType`.
    const strategy = serializer.strategy as (input: {
      serializerType: TSerializerType;
      value: TSerializerNativeValue<TSerializerType>;
      context?: ISerializerContext;
    }) => unknown;
    return strategy({ serializerType, value, context });
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
    for (const serializerType of SERIALIZER_TYPES) {
      const serializer = this.serializerRegistry.get(serializerType);
      if (serializer) snapshot.set(serializerType, serializer);
    }
    return snapshot;
  }

  protected hasSerializer(serializerType: TSerializerType): boolean {
    return this.serializerRegistry.has(serializerType);
  }

  protected registerSerializer(options: TSetSerializer): void {
    this.serializerRegistry.set(options.serializerType, options);
  }

  protected unregisterSerializer(serializerType: TSerializerType): void {
    this.serializerRegistry.delete(serializerType);
  }

  protected clearSerializerRegistry(): void {
    for (const serializerType of SERIALIZER_TYPES)
      this.unregisterSerializer(serializerType);
  }

  protected get registeredSerializerTypes(): ReadonlyArray<TSerializerType> {
    return SERIALIZER_TYPES.filter((serializerType) =>
      this.hasSerializer(serializerType)
    );
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
