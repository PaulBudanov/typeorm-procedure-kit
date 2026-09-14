import { TypeOverrides, types } from 'pg';

import { ServerError } from '../../utils/server-error.js';
import { DatabaseSerializer } from '../abstract/database-serializer.js';

import type {
  TSerializerType,
  TSetSerializer,
} from '../../types/serializer.types.js';
import type { CustomTypesConfig, FieldDef } from 'pg';

export class PostgreSerializer extends DatabaseSerializer {
  private static readonly OBJECT_TYPE_CAST: Partial<
    Record<TSerializerType, ReadonlyArray<number>>
  > = {
    BINARY: [types.builtins.BYTEA],
    BOOLEAN: [types.builtins.BOOL],
    CHAR: [types.builtins.CHAR],
    DATE: [types.builtins.DATE],
    VARCHAR: [types.builtins.VARCHAR],
    JSON: [types.builtins.JSON, types.builtins.JSONB],
    TIMESTAMP: [types.builtins.TIMESTAMP],
    TIMESTAMP_TZ: [types.builtins.TIMESTAMPTZ],
    TIMESTAMP_LTZ: [types.builtins.TIMESTAMPTZ],
    XML: [types.builtins.XML],
  };
  private readonly typeOverrides = new TypeOverrides();
  private readonly defaultTypeParsers = new Map<
    number,
    (value: string) => unknown
  >(
    Array.from(
      new Set(Object.values(PostgreSerializer.OBJECT_TYPE_CAST).flat())
    ).map((oid) => [oid, types.getTypeParser(oid)])
  );

  public override registerFetchHandlerHook(): void {
    if (this.options.isNeedRegisterDefaultSerializers)
      this.registerDefaultSerializers();
  }

  public getTypeOverrides(): CustomTypesConfig {
    return this.typeOverrides;
  }

  public transformRows(
    rows: Array<unknown>,
    _fields: Array<FieldDef>
  ): Array<unknown> {
    return rows.map((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row))
        return row;
      const outputNames = new Map<string, string>();
      return Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([key, value]) => {
          const outputName = this.options.caseStrategy.transformColumnName(key);
          const originalName = outputNames.get(outputName);
          if (originalName !== undefined) {
            throw new ServerError(
              `PostgreSQL result columns "${originalName}" and "${key}" have conflicting transformed name "${outputName}"`
            );
          }
          outputNames.set(outputName, key);
          return [outputName, value];
        })
      );
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

  public override setSerializer(options: TSetSerializer): void {
    if (this.hasSerializer(options.serializerType)) {
      this.logger.warn(
        `Serializer with type ${options.serializerType} already exists, overriding...`
      );
      this.unregisterSerializer(options.serializerType);
    }
    const dbTypeClasses =
      PostgreSerializer.OBJECT_TYPE_CAST[options.serializerType];
    if (!dbTypeClasses)
      throw new ServerError(
        `Unknown serializer type: ${options.serializerType}`
      );
    this.registerSerializer(options);
    this.registerTypeParser(options.serializerType);
    this.logger.log(
      `Serializer with type ${options.serializerType} and dbType ${dbTypeClasses.join(', ')} set successfully`
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
    const dbTypeClasses =
      PostgreSerializer.OBJECT_TYPE_CAST[serializerType.serializerType];
    if (dbTypeClasses === undefined) return;
    for (const dbTypeClass of dbTypeClasses) {
      const replacementType = this.registeredSerializerTypes.find(
        (registeredType) =>
          PostgreSerializer.OBJECT_TYPE_CAST[registeredType]?.includes(
            dbTypeClass
          )
      );
      if (replacementType) {
        this.registerTypeParser(replacementType);
      } else {
        const defaultParser = this.defaultTypeParsers.get(dbTypeClass);
        if (defaultParser === undefined) {
          throw new ServerError(
            `Default PostgreSQL parser is missing for dbType ${dbTypeClass}`
          );
        }
        this.typeOverrides.setTypeParser(dbTypeClass, defaultParser);
      }
    }
    return;
  }

  /**
   * Deletes all registered serializers.
   * This method is useful when you need to register new serializers or use default serializers,
   * but don't want to keep the old ones.
   */
  public override deleteAllSerializers(): void {
    this.clearSerializerRegistry();
    this.defaultTypeParsers.forEach((parser, oid) => {
      this.typeOverrides.setTypeParser(oid, parser);
    });
    return;
  }

  private registerTypeParser(serializerType: TSerializerType): void {
    const dbTypeClasses = PostgreSerializer.OBJECT_TYPE_CAST[serializerType];
    if (dbTypeClasses === undefined) {
      throw new ServerError(`Unknown serializer type: ${serializerType}`);
    }
    for (const dbTypeClass of dbTypeClasses) {
      this.typeOverrides.setTypeParser(dbTypeClass, (value: string) =>
        this.serializeValue(serializerType, value, {
          source: 'fetch',
          database: 'postgres',
          databaseType: String(dbTypeClass),
        })
      );
    }
  }
}
