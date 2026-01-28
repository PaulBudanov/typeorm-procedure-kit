import { Result, types } from 'pg';

import type {
  IRegisteredFetchHandlerOptions,
  TPostgreObjectTypeCast,
  TPostgreSerializerTypeCastWithoutFormat,
  TSetSerializer,
} from '../../types.js';

import { PostgreNotify } from './postgre-notify.js';

//TODO: In future add one abstract class for all adapters serializers with common methods
export class PostgreSerializer extends PostgreNotify {
  private TYPE_SERIALIZER_MAP: TPostgreSerializerTypeCastWithoutFormat =
    new Map();

  private readonly OBJECT_TYPE_CAST: TPostgreObjectTypeCast = {
    BINARY: types.builtins.BYTEA,
    BOOLEAN: types.builtins.BOOL,
    CHAR: types.builtins.CHAR,
    DATE: types.builtins.DATE,
    VARCHAR: types.builtins.VARCHAR,
    JSON: types.builtins.JSON,
    TIMESTAMP: types.builtins.TIMESTAMP,
    TIMESTAMP_TZ: types.builtins.TIMESTAMPTZ,
    XML: types.builtins.XML,
  };

  // private keyCaseTransform: KeyCaseTransform = new KeyCaseTransform();
  /**
   * Registers a custom fetch handler for PostgreSQL.
   * This method is used to register a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param options - An object with the following properties:
   *   isNeedRegisterDefaultSerializers - A flag indicating whether to register default serializers for the following types: DATE, TIMESTAMP, TIMESTAMP_TZ.
   *   isNeedRegisterParamKeyTransform - A flag indicating whether to register a custom param key transformer.
   */
  public registerFetchHandlerHook(
    options: IRegisteredFetchHandlerOptions,
  ): void {
    //TODO : In future add default serializers, and make two flags for control of it or refactor logic for initialization this features
    if (options.isNeedRegisterDefaultSerializers)
      this.registerDefaultSerializers();

    (
      Result.prototype as Result & {
        parseRow: (
          rowData: Array<string | Buffer | null>,
        ) => Record<string, unknown>;
      }
    ).parseRow = function (
      this: Result & {
        _parsers: Array<(value: string | Buffer | null) => unknown>;
        _prebuiltEmptyResultObject: Record<string, null>;
      },
      rowData: Array<string | Buffer | null>,
    ): Record<string, unknown> {
      const row: Record<string, unknown> = {
        ...this._prebuiltEmptyResultObject,
      };
      for (let i = 0, len = rowData.length; i < len; i++) {
        const rawValue = rowData[i];
        const field = this.fields[i].name;
        if (
          !field ||
          (this.fields[i]
            .dataTypeID as (typeof types.builtins)[keyof typeof types.builtins]) ===
            types.builtins.REFCURSOR
        )
          continue;
        delete row[field];
        if (rawValue !== null) {
          // console.log(this.fields[i]);
          const valueToParse =
            this.fields[i].format === 'binary'
              ? Buffer.from(rawValue)
              : rawValue;
          row[options.caseNativeStrategy.transformColumnName(field)] =
            this._parsers[i](valueToParse);
        } else {
          row[options.caseNativeStrategy.transformColumnName(field)] = null;
        }
      }
      return row;
    };
    return;
  }

  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param options - An object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws Error - If the serializer type is unknown.
   */

  public setSerializer(options: TSetSerializer): void {
    if (this.TYPE_SERIALIZER_MAP.has(options.serializerType)) {
      this.logger.warn(
        `Serializer with type ${options.serializerType} already exists, overriding...`,
      );
      this.TYPE_SERIALIZER_MAP.delete(options.serializerType);
    }
    const dbTypeClass = this.OBJECT_TYPE_CAST[options.serializerType];
    if (!dbTypeClass)
      throw new Error(`Unknown serializer type: ${options.serializerType}`);
    this.TYPE_SERIALIZER_MAP.set(options.serializerType, {
      type: dbTypeClass,
      strategy: options.strategy,
    });
    types.setTypeParser(dbTypeClass, options.strategy);
    this.logger.log(
      `Serializer with type ${options.serializerType} and dbType ${dbTypeClass} set successfully`,
    );
    return;
  }

  // TODO: Added in future default serializers for must popular types.
  /**
   * Registers default serializers for the following types: DATE, TIMESTAMP, TIMESTAMP_TZ.
   * The registered serializers will use the following formatting rules:
   * - DATE: 'yyyy-MM-dd'
   * - TIMESTAMP: 'yyyy-MM-dd HH:mm:ss'
   * - TIMESTAMP_TZ: 'yyyy-MM-dd HH:mm:ss'
   */
  private registerDefaultSerializers(): void {
    this.logger.log('Default serializers successfully registered');
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   */
  public deleteSerializer(
    serializerType: Pick<TSetSerializer, 'serializerType'>,
  ): void {
    if (this.TYPE_SERIALIZER_MAP.has(serializerType.serializerType))
      this.TYPE_SERIALIZER_MAP.delete(serializerType.serializerType);
    const dbTypeClass = this.OBJECT_TYPE_CAST[serializerType.serializerType];
    types.setTypeParser(dbTypeClass, (val: string) => val);
    return;
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public deleteAllSerializers(): void {
    this.TYPE_SERIALIZER_MAP.clear();
    Object.entries(types.builtins).forEach(([_, value]) => {
      types.setTypeParser(value, (val: string) => val);
    });
    return;
  }

  public get serializerMapping(): TPostgreSerializerTypeCastWithoutFormat {
    return this.TYPE_SERIALIZER_MAP;
  }
}
