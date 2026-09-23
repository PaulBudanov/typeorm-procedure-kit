import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type {
  TSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../types/serializer.types.js';

/**
 * Pass-through from `TypeOrmProcedureKit` to the adapter's serializer registry.
 *
 * It owns no behaviour: registration is validated by `DatabaseSerializer`, which every vendor
 * shares and which also sits behind the public `TypeOrmProcedureKit.databaseAdapter`, and the
 * read-only snapshot is produced there too, where registry changes are known exactly. The class
 * is kept only because removing it means editing `src/core/index.ts`.
 */
export class SerializerBase {
  public constructor(
    protected readonly databaseAdapter: TAdapterUtilsClassTypes
  ) {}
  /**
   * The adapter's registry snapshot, unchanged: already read-only, in canonical order, and the
   * same object across reads until the registry changes.
   *
   * @readonly
   * @throws {Error} If you try to modify the map.
   */
  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return this.databaseAdapter.serializerMapping;
  }
  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param options - An object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws Error - If the options are not an object, the serializer type is unknown, or the
   * strategy is not a function.
   */
  public setSerializer(options: TSetSerializer): void {
    this.databaseAdapter.setSerializer(options);
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public deleteAllSerializers(): void {
    this.databaseAdapter.deleteAllSerializers();
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   * @throws Error - If the serializer type is unknown.
   */
  public deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void {
    this.databaseAdapter.deleteSerializer(serializerType);
  }
}
