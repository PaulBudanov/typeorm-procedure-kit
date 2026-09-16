import oracledb from 'oracledb';

import { ServerError } from '../../utils/server-error.js';
import { DatabaseSerializer } from '../abstract/database-serializer.js';

import type {
  TOracleObjectDbTypeHandlerCast,
  TSerializerType,
  TSetSerializer,
} from '../../types/serializer.types.js';
import type { DbType, FetchTypeResponse } from 'oracledb';

export class OracleSerializer extends DatabaseSerializer {
  private static readonly OBJECT_TYPE_CAST: Partial<
    Record<TSerializerType, DbType>
  > = {
    BINARY: oracledb.DB_TYPE_BLOB,
    BOOLEAN: oracledb.DB_TYPE_BOOLEAN,
    CHAR: oracledb.DB_TYPE_CHAR,
    DATE: oracledb.DB_TYPE_DATE,
    VARCHAR: oracledb.DB_TYPE_VARCHAR,
    JSON: oracledb.DB_TYPE_JSON,
    TIMESTAMP: oracledb.DB_TYPE_TIMESTAMP,
    TIMESTAMP_TZ: oracledb.DB_TYPE_TIMESTAMP_TZ,
    TIMESTAMP_LTZ: oracledb.DB_TYPE_TIMESTAMP_LTZ,
    XML: oracledb.DB_TYPE_XMLTYPE,
  };
  private objectDbTypeHandlerCast: TOracleObjectDbTypeHandlerCast = new Map();

  /**
   * Registers a custom fetch handler for Oracle DB.
   * This method is used to register a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   */
  public override registerFetchHandlerHook(): void {
    if (this.options.isNeedRegisterDefaultSerializers)
      this.registerDefaultSerializers();
  }

  /**
   * Creates an instance-scoped handler for an Oracle execute call.
   *
   * node-oracledb invokes the handler once per column and supplies the whole
   * rowset metadata array as the second argument. That array is rebuilt for
   * every execute, so `rowsetMetaData[0] === metaData` marks the first column
   * of one statement while every name is still raw. The collision check runs
   * there and keeps no state between calls, which is why two separate queries
   * sharing a column name can never be reported as a conflict.
   *
   * Drivers that do not pass the rowset metadata simply skip the check.
   */
  public createFetchTypeHandler(): (
    metaData: oracledb.Metadata<unknown>,
    rowsetMetaData?: ReadonlyArray<oracledb.Metadata<unknown>>
  ) => FetchTypeResponse | undefined {
    return (metaData, rowsetMetaData): FetchTypeResponse | undefined => {
      this.assertNoRowsetColumnCollision(metaData, rowsetMetaData);
      if (metaData.dbType !== oracledb.DB_TYPE_CURSOR)
        metaData.name = this.options.caseStrategy.transformColumnName(
          metaData.name
        );
      if (
        metaData.dbType !== undefined &&
        this.objectDbTypeHandlerCast.has(metaData.dbType)
      ) {
        const serializeKey = this.objectDbTypeHandlerCast.get(metaData.dbType);
        if (serializeKey === undefined) return;
        if (!this.hasSerializer(serializeKey)) return { type: metaData.dbType };
        const converter = (value: unknown): unknown =>
          this.serializeValue(serializeKey, value, {
            source: 'fetch',
            database: 'oracle',
            name: metaData.name,
            databaseType: metaData.dbType?.columnTypeName,
          });
        return {
          type: metaData.dbType,
          converter: converter,
        };
      }
      return;
    };
  }

  /**
   * Rejects a rowset whose columns would share one output name.
   *
   * The check runs only on the first column of a rowset, while every name in
   * the array is still raw, and does nothing on the remaining columns or when
   * the driver supplies no rowset metadata. REF CURSOR columns keep their raw
   * name because the handler never renames them, so they take part in the
   * check under that raw name.
   * @param metaData - the column the driver is currently asking about.
   * @param rowsetMetaData - every column of a single Oracle statement.
   * @throws ServerError - when two columns map onto the same output name.
   */
  private assertNoRowsetColumnCollision(
    metaData: oracledb.Metadata<unknown>,
    rowsetMetaData?: ReadonlyArray<oracledb.Metadata<unknown>>
  ): void {
    if (rowsetMetaData === undefined) return;
    if (rowsetMetaData[0] !== metaData) return;
    const outputNames = new Map<string, string>();
    for (const column of rowsetMetaData) {
      const rawName = column.name;
      const outputName =
        column.dbType === oracledb.DB_TYPE_CURSOR
          ? rawName
          : this.options.caseStrategy.transformColumnName(rawName);
      const originalName = outputNames.get(outputName);
      if (originalName !== undefined) {
        throw new ServerError(
          `Oracle result columns "${originalName}" and "${rawName}" have conflicting transformed name "${outputName}"`
        );
      }
      outputNames.set(outputName, rawName);
    }
  }

  /**
   * Registers a custom serializer for the given type.
   * If a serializer with the same type already exists, it will be overridden.
   * @param options - An object with the following properties:
   *   serializerType - The type of the data to be serialized (e.g. 'DATE', 'TIMESTAMP', 'TIMESTAMP_TZ').
   *   strategy - A function that takes a value of the given type and returns a serialized string.
   * @throws Error - If the serializer type is unknown.
   */
  public override setSerializer(options: TSetSerializer): void {
    if (this.hasSerializer(options.serializerType)) {
      this.logger.warn(
        `Serializer with type ${options.serializerType} already exists, overriding...`
      );
      this.unregisterSerializer(options.serializerType);
    }
    const dbTypeClass =
      OracleSerializer.OBJECT_TYPE_CAST[options.serializerType];
    if (!dbTypeClass)
      throw new ServerError(
        `Unknown serializer type: ${options.serializerType}`
      );
    if (this.objectDbTypeHandlerCast.has(dbTypeClass)) {
      this.logger.warn(
        `Serializer with dbType ${dbTypeClass.columnTypeName} already exists, overriding...`
      );
      this.objectDbTypeHandlerCast.delete(dbTypeClass);
    }
    this.registerSerializer(options);
    this.objectDbTypeHandlerCast.set(dbTypeClass, options.serializerType);
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
    serializerType: Pick<TSetSerializer, 'serializerType'>
  ): void {
    if (this.hasSerializer(serializerType.serializerType))
      this.unregisterSerializer(serializerType.serializerType);
    const dbTypeClass =
      OracleSerializer.OBJECT_TYPE_CAST[serializerType.serializerType];
    if (dbTypeClass === undefined) return;
    if (this.objectDbTypeHandlerCast.has(dbTypeClass))
      this.objectDbTypeHandlerCast.delete(dbTypeClass);
    return;
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public override deleteAllSerializers(): void {
    this.clearSerializerRegistry();
    this.objectDbTypeHandlerCast.clear();
    return;
  }
}
