import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type {
  ISetSerializer,
  TSerializerTypeCastWithoutFormat,
} from '../types/serializer.types.js';
import { ServerError } from '../utils/server-error.js';

export class SerializerBase {
  public constructor(
    protected readonly databaseAdapter: TAdapterUtilsClassTypes
  ) {}
  /**
   * A read-only map of serializers, where the key is the name of the serializer
   * and the value is the serializer itself.
   *
   * @readonly
   * @throws {Error} If you try to modify the map.
   */
  public get serializerReadOnlyMapping(): Readonly<TSerializerTypeCastWithoutFormat> {
    return new Proxy(this.databaseAdapter.serializerMapping, {
      get(target, prop): unknown {
        if (prop === 'set' || prop === 'clear' || prop === 'delete') {
          throw new ServerError('Read-only map: cannot modify');
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function'
          ? (value.bind(target) as Pick<ISetSerializer, 'strategy'>)
          : value;
      },

      set(): never {
        throw new ServerError('Read-only map: cannot modify');
      },
      deleteProperty(): never {
        throw new ServerError('Read-only map: cannot modify');
      },
    });
  }
  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param options - An object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws Error - If the serializer type is unknown.
   */
  public setSerializer(options: ISetSerializer): void {
    return this.databaseAdapter.setSerializer(options);
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public deleteAllSerializers(): void {
    return this.databaseAdapter.deleteAllSerializers();
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   */
  public deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void {
    return this.databaseAdapter.deleteSerializer(serializerType);
  }
}
