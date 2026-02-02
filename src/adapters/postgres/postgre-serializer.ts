import { Result, types } from 'pg';

import type { ISetSerializer } from '../../types/serializer.types.js';
import { DatabaseSerializer } from '../abstract/database-serializer.js';
import { ServerError } from '../../utils/server-error.js';

export class PostgreSerializer extends DatabaseSerializer {
  private readonly OBJECT_TYPE_CAST = {
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

  public registerFetchHandlerHook(): void {
    if (this.options.isNeedRegisterDefaultSerializers)
      this.registerDefaultSerializers();
    const options = this.options;
    //TODO: Find alternative solution
    (
      Result.prototype as Result & {
        parseRow: (
          rowData: Array<string | Buffer | null>
        ) => Record<string, unknown>;
      }
    ).parseRow = function (
      this: Result & {
        _parsers: Array<(value: string | Buffer | null) => unknown>;
        _prebuiltEmptyResultObject: Record<string, null>;
      },
      rowData: Array<string | Buffer | null>
    ): Record<string, unknown> {
      const row: Record<string, unknown> = {
        ...this._prebuiltEmptyResultObject,
      };
      for (let i = 0, len = rowData.length; i < len; i++) {
        const rawValue = rowData[i];
        const field = this.fields[i]?.name;
        if (
          !field ||
          (this.fields[i]
            ?.dataTypeID as (typeof types.builtins)[keyof typeof types.builtins]) ===
            types.builtins.REFCURSOR
        )
          continue;
        delete row[field];
        if (rawValue !== null && rawValue !== undefined) {
          const valueToParse =
            this.fields[i]?.format === 'binary'
              ? Buffer.from(rawValue)
              : rawValue;
          row[options.caseNativeStrategy.transformColumnName(field)] = (
            this._parsers[i] as (value: string | Buffer | null) => unknown
          )(valueToParse);
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

  public setSerializer(options: ISetSerializer): void {
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
    this.TYPE_SERIALIZER_MAP.set(options.serializerType, {
      strategy: options.strategy,
    });
    types.setTypeParser(dbTypeClass, options.strategy);
    this.logger.log(
      `Serializer with type ${options.serializerType} and dbType ${dbTypeClass} set successfully`
    );
    return;
  }

  /**
   * Deletes a serializer with the given type.
   * @param serializerType - The type of the serializer to delete.
   */
  public deleteSerializer(
    serializerType: Pick<ISetSerializer, 'serializerType'>
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
}
