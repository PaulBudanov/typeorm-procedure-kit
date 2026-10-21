import { TypeOverrides, types } from 'pg';

import { isInKitCall } from '../../utils/kit-call-context.js';
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
  /** The name plan of the last described statement; see `resolveDescribedOutputNames`. */
  private describedOutputNames:
    | {
        readonly fields: ReadonlyArray<FieldDef>;
        readonly collisionHandling: 'error' | 'warn';
        readonly outputNames: ReadonlyMap<string, string>;
      }
    | undefined;
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
   *
   * Inside a kit call two columns that map onto one output name are an error. Any other query
   * through the DataSource gets a warning instead, once per described statement and once per
   * undescribed row, and each row keeps the last of the equally named values: node-postgres has
   * already dropped the others for a repeated raw name, and a later column wins for names that
   * only collide after case conversion.
   * @param rows - the rows node-postgres produced.
   * @param fields - that statement's row description, or `[]` when the runner has none.
   * @returns the rows with renamed keys; rows that are not plain objects are returned as they are.
   * @throws ServerError - inside a kit call, when two columns map onto the same output name.
   */
  public transformRows(
    rows: Array<unknown>,
    fields: Array<FieldDef>
  ): Array<unknown> {
    const collisionHandling = isInKitCall() ? 'error' : 'warn';
    if (fields.length === 0) {
      return rows.map((row) =>
        PostgreSerializer.isRowObject(row)
          ? this.renameRow(
              row,
              this.planOutputNames(Object.keys(row), collisionHandling)
            )
          : row
      );
    }
    const outputNames = this.resolveDescribedOutputNames(
      fields,
      collisionHandling
    );
    return rows.map((row) =>
      PostgreSerializer.isRowObject(row)
        ? this.renameRow(row, outputNames)
        : row
    );
  }

  /**
   * Maps every column of a row description onto its output name, once per statement.
   *
   * The row itself cannot answer that question for a repeated name. node-postgres builds an
   * object row by assigning `row[field.name]` column by column (`pg/lib/result.js` `parseRow`),
   * so `SELECT a.id, b.id` arrives as a single `id` key holding the second value, and the first
   * column is gone before this serializer runs. The row description, which node-postgres keeps
   * beside the rows as `fields`, is the one place both columns still exist, so the check is made
   * on it: before any row is touched, and whether or not the statement returned rows. That
   * mirrors `OracleSerializer.checkRowsetColumnCollision`, which checks the rowset metadata before
   * the first row is fetched, and reports the same message.
   *
   * A streamed statement arrives one row per call with the same `fields` array, so the plan for
   * the last description is kept and reused while that array and the collision handling stay the
   * same. The handling is part of the key so that a plan made, with a warning, for a query outside
   * a kit call is never reused for a kit call.
   *
   * An empty description — what `PostgresQueryRunner` passes when a result has no `fields` —
   * never reaches this method: renaming then falls back to the keys each row has, as the Oracle
   * check is skipped when the driver supplies no rowset metadata.
   * @param fields - the row description of one statement.
   * @param collisionHandling - whether a collision throws or is logged as a warning.
   * @returns raw column name to output name, for every described column.
   * @throws ServerError - when `collisionHandling` is `'error'` and two columns map onto the same
   * output name.
   */
  private resolveDescribedOutputNames(
    fields: ReadonlyArray<FieldDef>,
    collisionHandling: 'error' | 'warn'
  ): ReadonlyMap<string, string> {
    const plan = this.describedOutputNames;
    if (plan?.fields === fields && plan.collisionHandling === collisionHandling)
      return plan.outputNames;
    const outputNames = this.planOutputNames(
      fields.map(({ name }) => name),
      collisionHandling
    );
    this.describedOutputNames = { fields, collisionHandling, outputNames };
    return outputNames;
  }

  /**
   * Maps raw column names onto their output names and handles the first pair that would share
   * one: both PostgreSQL checks, on a row description and on the keys of an undescribed row, go
   * through it.
   * @param rawNames - the raw column names of one statement, or of one undescribed row.
   * @param collisionHandling - `'error'` throws, `'warn'` logs one warning and carries on.
   * @returns raw column name to output name, for every given name.
   * @throws ServerError - when `collisionHandling` is `'error'` and two names map onto the same
   * output name.
   */
  private planOutputNames(
    rawNames: ReadonlyArray<string>,
    collisionHandling: 'error' | 'warn'
  ): ReadonlyMap<string, string> {
    const outputNames = new Map<string, string>();
    const sourceNames = new Map<string, string>();
    let collision: string | undefined;
    for (const rawName of rawNames) {
      const outputName = this.options.caseStrategy.transformColumnName(rawName);
      const originalName = sourceNames.get(outputName);
      if (originalName !== undefined) {
        collision ??= `PostgreSQL result columns "${originalName}" and "${rawName}" have conflicting transformed name "${outputName}"`;
        if (collisionHandling === 'error') throw new ServerError(collision);
      }
      sourceNames.set(outputName, rawName);
      outputNames.set(rawName, outputName);
    }
    if (collision !== undefined) this.logger.warn(collision);
    return outputNames;
  }

  /**
   * Renames one row's keys, in the row's own key order.
   * @param row - a plain object row.
   * @param outputNames - the statement's name plan; a key it lacks goes through the case strategy.
   * @returns a new row whose keys are all own properties, `__proto__` included.
   */
  private renameRow(
    row: Record<string, unknown>,
    outputNames: ReadonlyMap<string, string>
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        outputNames.get(key) ??
          this.options.caseStrategy.transformColumnName(key),
        value,
      ])
    );
  }

  /**
   * Narrows a result row to the object form whose keys are renamed.
   * @param row - one row as node-postgres produced it.
   * @returns true for a plain object row, false for `rowMode: 'array'` rows and other values.
   */
  private static isRowObject(row: unknown): row is Record<string, unknown> {
    return row !== null && typeof row === 'object' && !Array.isArray(row);
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
