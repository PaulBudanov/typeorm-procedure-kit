import type {
  // IEntityOptions,
  // ILoggerModule,
  // IMigrationOptions,
  // TDbConfig,
  TOracleSerializerTypeCastWithoutFormat,
  TPostgreSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../types.js';

import { ProcedureListBase } from './procedure-list-base.js';

export class SerializerBase extends ProcedureListBase {
  /**
   * A read-only map of serializers, where the key is the name of the serializer
   * and the value is the serializer itself.
   *
   * @readonly
   * @throws {Error} If you try to modify the map.
   */
  public get serializerReadOnlyMapping(): Readonly<
    | TPostgreSerializerTypeCastWithoutFormat
    | TOracleSerializerTypeCastWithoutFormat
  > {
    return new Proxy(this.dbUtilsInstance.serializerMapping, {
      get(target, prop) {
        if (prop === 'set' || prop === 'clear' || prop === 'delete') {
          throw new Error('Read-only map: cannot modify');
        }
        const value = Reflect.get(target, prop) as unknown;
        return typeof value === 'function'
          ? (value.bind(target) as Pick<TSetSerializer, 'strategy'>)
          : value;
      },

      set() {
        throw new Error('Read-only map: cannot modify');
      },
      deleteProperty() {
        throw new Error('Read-only map: cannot modify');
      },
    });
  }
  // ? Maybe needed refactor after make two flags and default serializers
  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param options - An object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws Error - If the serializer type is unknown.
   */
  public setSerializer(options: TSetSerializer): void {
    return this.dbUtilsInstance.setSerializer(options);
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public deleteAllSerializers(): void {
    return this.dbUtilsInstance.deleteAllSerializers();
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   */
  public deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>,
  ): void {
    return this.dbUtilsInstance.deleteSerializer(serializerType);
  }
}
