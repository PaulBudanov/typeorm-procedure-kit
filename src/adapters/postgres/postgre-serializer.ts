import { TypeOverrides, types } from 'pg';

import { ServerError } from '../../utils/server-error.js';
import { DatabaseSerializer } from '../abstract/database-serializer.js';

import type {
  TSerializerType,
  TSetSerializer,
} from '../../types/serializer.types.js';
import type { CustomTypesConfig, FieldDef } from 'pg';

export class PostgreSerializer extends DatabaseSerializer {
  /**
   * Type OIDs for every serializer type. Complete by construction, so a new member of
   * `TSerializerType` does not compile until it is mapped here. It is only ever indexed with a
   * member already validated by `DatabaseSerializer`, never with a caller's raw value.
   */
  private static readonly OBJECT_TYPE_CAST: Readonly<
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

  /**
   * Renames the columns of one statement's rows through the case strategy.
   * @param rows - the rows node-postgres produced.
   * @param fields - that statement's row description, or `[]` when the runner has none.
   * @returns the rows with renamed keys; rows that are not plain objects are returned as they are.
   * @throws ServerError - when two columns map onto the same output name.
   */
  public transformRows(
    rows: Array<unknown>,
    fields: Array<FieldDef>
  ): Array<unknown> {
    const describedNames = this.resolveDescribedOutputNames(fields);
    return rows.map((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row))
        return row;
      const outputNames = new Map<string, string>();
      return Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([key, value]) => {
          const outputName =
            describedNames.get(key) ??
            this.options.caseStrategy.transformColumnName(key);
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
   * Maps every column of a row description onto its output name, rejecting a description in
   * which two columns would share one.
   *
   * The row itself cannot answer that question for a repeated name. node-postgres builds an
   * object row by assigning `row[field.name]` column by column (`pg/lib/result.js` `parseRow`),
   * so `SELECT a.id, b.id` arrives as a single `id` key holding the second value, and the first
   * column is gone before this serializer runs. The row description, which node-postgres keeps
   * beside the rows as `fields`, is the one place both columns still exist, so the check is made
   * on it: once per statement, before any row is touched, and whether or not the statement
   * returned rows. That mirrors `OracleSerializer.assertNoRowsetColumnCollision`, which checks
   * the rowset metadata before the first row is fetched, and raises the same message.
   *
   * An empty description — what `PostgresQueryRunner` passes when a result has no `fields` —
   * yields an empty map, and renaming falls back to the keys the row has, as the Oracle check is
   * skipped when the driver supplies no rowset metadata.
   * @param fields - the row description of one statement.
   * @returns raw column name to output name, for every described column.
   * @throws ServerError - when two columns map onto the same output name.
   */
  private resolveDescribedOutputNames(
    fields: ReadonlyArray<FieldDef>
  ): ReadonlyMap<string, string> {
    const outputNames = new Map<string, string>();
    const sourceNames = new Map<string, string>();
    for (const { name } of fields) {
      const outputName = this.options.caseStrategy.transformColumnName(name);
      const originalName = sourceNames.get(outputName);
      if (originalName !== undefined) {
        throw new ServerError(
          `PostgreSQL result columns "${originalName}" and "${name}" have conflicting transformed name "${outputName}"`
        );
      }
      sourceNames.set(outputName, name);
      outputNames.set(name, outputName);
    }
    return outputNames;
  }

  /**
   * Records the strategy and installs a type parser for each of its OIDs on this instance.
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
    const dbTypeClasses =
      PostgreSerializer.OBJECT_TYPE_CAST[options.serializerType];
    this.registerSerializer(options);
    this.registerTypeParser(options.serializerType);
    this.logger.log(
      `Serializer with type ${options.serializerType} and dbType ${dbTypeClasses.join(', ')} set successfully`
    );
    return;
  }

  /**
   * Forgets the strategy and gives each of its OIDs back to another registered strategy that
   * covers it, or to the default pg parser when none does.
   * @param serializerType - a type already validated by `DatabaseSerializer.deleteSerializer`.
   */
  protected override uninstallSerializer(
    serializerType: TSerializerType
  ): void {
    if (this.hasSerializer(serializerType))
      this.unregisterSerializer(serializerType);
    for (const dbTypeClass of PostgreSerializer.OBJECT_TYPE_CAST[
      serializerType
    ]) {
      const replacementType = this.registeredSerializerTypes.find(
        (registeredType) =>
          PostgreSerializer.OBJECT_TYPE_CAST[registeredType].includes(
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
    for (const dbTypeClass of PostgreSerializer.OBJECT_TYPE_CAST[
      serializerType
    ]) {
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
