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
  /**
   * Driver type for every serializer type. Complete by construction, so a new member of
   * `TSerializerType` does not compile until it is mapped here. It is only ever indexed with a
   * member already validated by `DatabaseSerializer`, never with a caller's raw value.
   */
  private static readonly OBJECT_TYPE_CAST: Readonly<
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
  /** Numeric code node-oracledb Thick mode reports for a REF CURSOR column. */
  private static readonly CURSOR_DB_TYPE_NUMBER: number =
    oracledb.DB_TYPE_CURSOR.num;
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
   * That second argument is not part of the declared driver contract, so a
   * driver that omits it, or passes something other than an array, simply skips
   * the check instead of failing the query.
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
   *
   * The second argument is undeclared by `@types/oracledb` and was only
   * verified on node-oracledb 7.0.0, while the supported peer range is
   * `^6.0.0 || ^7.0.0`. It is therefore validated rather than trusted: anything
   * that is not a real array is ignored, and an entry without a string name is
   * skipped. Either way the check is quietly lost, never turned into an error
   * on a query the driver would have run.
   * @param metaData - the column the driver is currently asking about.
   * @param rowsetMetaData - every column of a single Oracle statement.
   * @throws ServerError - when two columns map onto the same output name.
   */
  private assertNoRowsetColumnCollision(
    metaData: oracledb.Metadata<unknown>,
    rowsetMetaData?: ReadonlyArray<oracledb.Metadata<unknown>>
  ): void {
    if (!OracleSerializer.isRowsetArray(rowsetMetaData)) return;
    if (rowsetMetaData[0] !== metaData) return;
    const outputNames = new Map<string, string>();
    for (const column of rowsetMetaData) {
      const rawName = OracleSerializer.readColumnName(column);
      if (rawName === undefined) continue;
      const outputName = OracleSerializer.isCursorColumn(column)
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
   * Narrows the driver's undeclared second argument to a genuine array.
   * @param rowsetMetaData - whatever the driver passed as the second argument.
   * @returns true only for a real array, which alone is safe to iterate.
   */
  private static isRowsetArray(
    rowsetMetaData: ReadonlyArray<oracledb.Metadata<unknown>> | undefined
  ): rowsetMetaData is ReadonlyArray<oracledb.Metadata<unknown>> {
    return Array.isArray(rowsetMetaData);
  }

  /**
   * Reads a rowset entry's raw column name, if it has a usable one.
   * @param column - one entry of the rowset metadata array.
   * @returns the raw name, or undefined when the entry carries no string name.
   */
  private static readColumnName(column: unknown): string | undefined {
    if (typeof column !== 'object' || column === null) return undefined;
    if (!('name' in column)) return undefined;
    const { name } = column;
    return typeof name === 'string' ? name : undefined;
  }

  /**
   * Reports whether a rowset column is a REF CURSOR, in either `dbType` form.
   *
   * node-oracledb normalises `dbType` from its numeric code to a `DbType`
   * object one column at a time, in the same loop that invokes the fetch type
   * handler and immediately before each invocation (`lib/impl/resultset.js`
   * `_setup` calling `addTypeProperties`). The rowset check runs on the first
   * column, so in Thick mode — the mode that reports numbers — every later
   * column is still unnormalised and an identity comparison against
   * `oracledb.DB_TYPE_CURSOR` would miss it. `dbTypeName` is no help either:
   * `addTypeProperties` derives it from that very normalisation step. The
   * numeric code is the one form both modes agree on, so the comparison goes
   * through it.
   * @param column - one entry of the rowset metadata array.
   * @returns true when the column fetches as a REF CURSOR.
   */
  private static isCursorColumn(column: unknown): boolean {
    if (typeof column !== 'object' || column === null) return false;
    if (!('dbType' in column)) return false;
    const { dbType } = column;
    if (typeof dbType === 'number')
      return dbType === OracleSerializer.CURSOR_DB_TYPE_NUMBER;
    if (typeof dbType !== 'object' || dbType === null) return false;
    if (!('num' in dbType)) return false;
    const { num } = dbType;
    return (
      typeof num === 'number' && num === OracleSerializer.CURSOR_DB_TYPE_NUMBER
    );
  }

  /**
   * Records the strategy and maps its Oracle driver type onto it for the fetch type handler.
   * If a serializer with the same type already exists, it will be overridden.
   * @param options - a serializer already validated by `DatabaseSerializer.setSerializer`.
   */
  protected override installSerializer(options: TSetSerializer): void {
    if (this.hasSerializer(options.serializerType)) {
      this.logger.warn(
        `Serializer with type ${options.serializerType} already exists, overriding...`
      );
      this.unregisterSerializer(options.serializerType);
    }
    const dbTypeClass =
      OracleSerializer.OBJECT_TYPE_CAST[options.serializerType];
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
   * Forgets the strategy and its driver type mapping, so the fetch handler stops converting it.
   * @param serializerType - a type already validated by `DatabaseSerializer.deleteSerializer`.
   */
  protected override uninstallSerializer(
    serializerType: TSerializerType
  ): void {
    if (this.hasSerializer(serializerType))
      this.unregisterSerializer(serializerType);
    const dbTypeClass = OracleSerializer.OBJECT_TYPE_CAST[serializerType];
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
