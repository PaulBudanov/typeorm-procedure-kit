import { DateFormatter } from '../../utils/date-formatter.js';
import { isPlainObject } from '../../utils/plain-object.js';
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

const READ_ONLY_MAPPING_MESSAGE = 'Read-only map: cannot modify';

/**
 * An immutable copy of the serializer registry, in canonical order.
 *
 * It is a real `Map`, so `instanceof Map`, iteration and `new Map(snapshot)` keep working. Its
 * three mutators throw instead of changing the copy: a caller who reaches past the `ReadonlyMap`
 * type and calls `set` expecting to register a serializer learns that it did not, instead of being
 * left with an altered copy and an unaltered registry. The instance is frozen, so the mutators
 * cannot be shadowed by own properties either. Merely reading one (`typeof snapshot.set`) is fine.
 */
class SerializerRegistrySnapshot extends Map<TSerializerType, TSetSerializer> {
  public constructor(
    entries: ReadonlyArray<readonly [TSerializerType, TSetSerializer]>
  ) {
    // No iterable goes to `super`: the Map constructor would feed it through the overridden `set`.
    super();
    for (const [serializerType, serializer] of entries)
      super.set(serializerType, serializer);
    Object.freeze(this);
  }

  public override set(): never {
    throw new ServerError(READ_ONLY_MAPPING_MESSAGE);
  }

  public override delete(): never {
    throw new ServerError(READ_ONLY_MAPPING_MESSAGE);
  }

  public override clear(): never {
    throw new ServerError(READ_ONLY_MAPPING_MESSAGE);
  }
}

export abstract class DatabaseSerializer {
  private readonly serializerRegistry = new Map<
    TSerializerType,
    TSetSerializer
  >();
  /**
   * The snapshot `serializerMapping` hands out, built on first read and dropped by every registry
   * change. Sharing it between reads is safe only because it cannot be mutated.
   */
  private registrySnapshot: SerializerRegistrySnapshot | undefined;

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

  /**
   * Registers a strategy for one serializer type, replacing any previous one.
   *
   * This is the single registration entry point for every vendor, so it is also where the
   * argument is checked at runtime. The signature already confines it to `TSetSerializer`, but a
   * JavaScript caller, or one that builds the type name from configuration, is not bound by that;
   * the vendor hook below only ever receives a member of the union with a callable strategy.
   * @param options - the serializer type and the strategy to apply to its values.
   * @throws ServerError - when `options` is not an object, its type is not a member of
   * `TSerializerType`, or its strategy is not a function. Nothing is registered in that case.
   */
  public setSerializer(options: TSetSerializer): void {
    DatabaseSerializer.assertSerializerOptions(options);
    this.installSerializer(options);
  }

  /**
   * Removes the strategy for one serializer type and restores the vendor's native handling.
   * Removing a type that is valid but not registered does nothing.
   * @param serializerType - an object naming the serializer type to remove.
   * @throws ServerError - when the argument is not an object or its type is not a member of
   * `TSerializerType`, so a misspelt type is reported rather than silently kept registered.
   */
  public deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void {
    DatabaseSerializer.assertSerializerSelector(serializerType);
    this.uninstallSerializer(serializerType.serializerType);
  }

  public abstract deleteAllSerializers(): void;

  /**
   * Vendor half of `setSerializer`: records the strategy and wires it into the driver.
   * @param options - already validated by `setSerializer`.
   */
  protected abstract installSerializer(options: TSetSerializer): void;

  /**
   * Vendor half of `deleteSerializer`: forgets the strategy and unwires it from the driver.
   * @param serializerType - already validated by `deleteSerializer`.
   */
  protected abstract uninstallSerializer(serializerType: TSerializerType): void;

  /**
   * The registered serializers, in the canonical `SERIALIZER_TYPES` order.
   *
   * The result is detached and immutable: a later registration never shows up in it, and its
   * `set`, `delete` and `clear` throw. Consecutive reads return the same object for as long as
   * the registry is unchanged, and a new one after any change.
   */
  public get serializerMapping(): TSerializerTypeCastWithoutFormat {
    if (this.registrySnapshot === undefined) {
      const entries: Array<readonly [TSerializerType, TSetSerializer]> = [];
      for (const serializerType of SERIALIZER_TYPES) {
        const serializer = this.serializerRegistry.get(serializerType);
        if (serializer) entries.push([serializerType, serializer]);
      }
      this.registrySnapshot = new SerializerRegistrySnapshot(entries);
    }
    return this.registrySnapshot;
  }

  protected hasSerializer(serializerType: TSerializerType): boolean {
    return this.serializerRegistry.has(serializerType);
  }

  protected registerSerializer(options: TSetSerializer): void {
    this.serializerRegistry.set(options.serializerType, options);
    this.registrySnapshot = undefined;
  }

  protected unregisterSerializer(serializerType: TSerializerType): void {
    this.serializerRegistry.delete(serializerType);
    this.registrySnapshot = undefined;
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

  /**
   * Checks the argument of `deleteSerializer`, and the type half of `setSerializer`'s.
   *
   * Membership is decided against `SERIALIZER_TYPES`, which is an array. It is never decided by
   * looking the value up in an object literal: `toString`, `constructor` and every other
   * `Object.prototype` key resolve there to an inherited value, which a truthiness guard accepts.
   * @param selector - the argument exactly as the caller passed it.
   * @throws ServerError - when it is not an object, or its type is outside `TSerializerType`.
   */
  private static assertSerializerSelector(
    selector: unknown
  ): asserts selector is Pick<TSetSerializer, 'serializerType'> {
    if (typeof selector !== 'object' || selector === null)
      throw new ServerError('Serializer options must be an object');
    const serializerType: unknown =
      'serializerType' in selector ? selector.serializerType : undefined;
    if (!SERIALIZER_TYPES.some((member) => member === serializerType))
      throw new ServerError(
        `Unknown serializer type: ${DatabaseSerializer.printSerializerType(serializerType)}`
      );
  }

  /**
   * Renders a rejected serializer type for the error message without running any of its code.
   * Objects and functions print as their tag: `String()` would call their own `toString`, which
   * can throw, or make `['DATE']` read as the valid type `DATE`.
   * @param serializerType - the value that failed the membership check.
   * @returns a printable form of it.
   */
  private static printSerializerType(serializerType: unknown): string {
    if (typeof serializerType === 'string') return serializerType;
    if (typeof serializerType === 'object' && serializerType !== null)
      return Object.prototype.toString.call(serializerType);
    if (typeof serializerType === 'function') return '[object Function]';
    return String(serializerType);
  }

  /**
   * Checks the argument of `setSerializer`: a valid type, and a strategy that can be called.
   * A strategy that is not a function would otherwise be stored and only fail later, once per
   * value, inside a driver type parser or fetch converter.
   * @param options - the argument exactly as the caller passed it.
   * @throws ServerError - on the first check that fails.
   */
  private static assertSerializerOptions(
    options: unknown
  ): asserts options is TSetSerializer {
    DatabaseSerializer.assertSerializerSelector(options);
    const strategy: unknown =
      'strategy' in options ? options.strategy : undefined;
    if (typeof strategy !== 'function')
      throw new ServerError(
        `Serializer strategy for ${options.serializerType} must be a function`
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
          isPlainObject(value)
        )
          return;
        break;
    }

    this.throwUnsupportedNativeValue(serializerType, value);
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
