import oracledb, { type FetchTypeResponse } from 'oracledb';

import type {
  ISetSerializer,
  TOracleObjectDbTypeHandlerCast,
} from '../../types/serializer.types.js';
import { ServerError } from '../../utils/server-error.js';
import { DatabaseSerializer } from '../abstract/database-serializer.js';

export class OracleSerializer extends DatabaseSerializer {
  private readonly OBJECT_TYPE_CAST = {
    BINARY: oracledb.DB_TYPE_BLOB,
    BOOLEAN: oracledb.DB_TYPE_BOOLEAN,
    CHAR: oracledb.DB_TYPE_CHAR,
    DATE: oracledb.DB_TYPE_DATE,
    VARCHAR: oracledb.DB_TYPE_VARCHAR,
    JSON: oracledb.DB_TYPE_JSON,
    TIMESTAMP: oracledb.DB_TYPE_TIMESTAMP,
    TIMESTAMP_TZ: oracledb.DB_TYPE_TIMESTAMP_TZ,
    XML: oracledb.DB_TYPE_XMLTYPE,
  };
  private OBJECT_DB_TYPE_HANDLER_CAST: TOracleObjectDbTypeHandlerCast =
    new Map();

  /**
   * Registers a custom fetch handler for Oracle DB.
   * This method is used to register a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   */
  public override registerFetchHandlerHook(): void {
    if (this.options.isNeedRegisterDefaultSerializers)
      this.registerDefaultSerializers();
    oracledb.fetchTypeHandler = (metaData): FetchTypeResponse | undefined => {
      if (metaData.dbType !== oracledb.DB_TYPE_CURSOR)
        metaData.name = this.options.caseNativeStrategy.transformColumnName(
          metaData.name
        );

      if (
        metaData.dbType &&
        this.OBJECT_DB_TYPE_HANDLER_CAST.has(metaData.dbType)
      ) {
        const serializeKey = this.OBJECT_DB_TYPE_HANDLER_CAST.get(
          metaData.dbType
        )!;
        const serializer = this.TYPE_SERIALIZER_MAP.get(serializeKey);
        if (!serializer) return { type: metaData.dbType };
        const converter = (value: unknown): unknown => {
          if (value === null || value === undefined) return null;
          switch (typeof value) {
            case 'string':
              return serializer.strategy(value);
            case 'number':
              return serializer.strategy(value.toString());
            case 'boolean':
              return serializer.strategy(String(value));
            case 'object':
              return serializer.strategy(
                value instanceof ArrayBuffer || value instanceof Buffer
                  ? value instanceof Buffer
                    ? value
                    : Buffer.from(value as ArrayBuffer)
                  : JSON.stringify(value)
              );
            case 'bigint':
              return serializer.strategy(value.toString());
            case 'symbol':
              return serializer.strategy(value.toString());
            default:
              throw new ServerError(
                `Unsupported type: ${typeof value} for ${metaData.name}`
              );
          }
        };
        return {
          type: metaData.dbType,
          converter: converter,
        };
      }
      return;
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
  public override setSerializer(options: ISetSerializer): void {
    if (this.TYPE_SERIALIZER_MAP.has(options.serializerType)) {
      this.logger.warn(
        `Serializer with type ${options.serializerType} already exists, overriding...`
      );
      this.TYPE_SERIALIZER_MAP.delete(options.serializerType);
    }
    const dbTypeClass = this.OBJECT_TYPE_CAST[options.serializerType];
    if (!dbTypeClass)
      throw new ServerError(
        `Unknown serializer type: ${options.serializerType}`
      );
    if (this.OBJECT_DB_TYPE_HANDLER_CAST.has(dbTypeClass)) {
      this.logger.warn(
        `Serializer with dbType ${dbTypeClass.columnTypeName} already exists, overriding...`
      );
      this.OBJECT_DB_TYPE_HANDLER_CAST.delete(dbTypeClass);
    }
    this.TYPE_SERIALIZER_MAP.set(options.serializerType, {
      strategy: options.strategy,
    });
    this.OBJECT_DB_TYPE_HANDLER_CAST.set(dbTypeClass, options.serializerType);
    this.logger.log(
      `Serializer with type ${options.serializerType} and dbType ${dbTypeClass.columnTypeName} set successfully`
    );
    return;
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   */
  public override deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
  ): void {
    if (this.TYPE_SERIALIZER_MAP.has(serializerType.serializerType))
      this.TYPE_SERIALIZER_MAP.delete(serializerType.serializerType);
    const dbTypeClass = this.OBJECT_TYPE_CAST[serializerType.serializerType];
    if (this.OBJECT_DB_TYPE_HANDLER_CAST.has(dbTypeClass))
      this.OBJECT_DB_TYPE_HANDLER_CAST.delete(dbTypeClass);
    return;
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public override deleteAllSerializers(): void {
    this.TYPE_SERIALIZER_MAP.clear();
    this.OBJECT_DB_TYPE_HANDLER_CAST.clear();
    return;
  }
}
