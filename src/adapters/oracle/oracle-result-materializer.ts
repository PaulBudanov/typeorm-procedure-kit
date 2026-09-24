import oracledb from 'oracledb';

import { DEFAULT_RESOURCE_LIMITS } from '../../utils/resource-limits.js';
import { ServerError } from '../../utils/server-error.js';
import { ProcedureResourceTracker } from '../abstract/procedure-resource-tracker.js';

import { OracleRecordOutBinding } from './oracle-bindings.js';

import type { IOracleValueSerializer } from '../../interfaces/oracle-result-materializer.interfaces.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { IProcedureStructuredField } from '../../types/procedure.types.js';
import type { TSerializerType } from '../../types/serializer.types.js';
import type {
  IProcedureOutBinding,
  IProcedureResult,
} from '../../types/utility.types.js';

/** Materializes Oracle scalar OUT values, LOBs, and REF CURSOR result sets. */
export class OracleProcedureResultMaterializer {
  public constructor(
    private readonly logger: ILoggerModule,
    private readonly options: IRegisteredFetchHandlerOptions,
    private readonly serializer: IOracleValueSerializer
  ) {}

  public async materialize<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    cursorsNames: Array<string>,
    outBindings: Array<IProcedureOutBinding>,
    rawOutBinds: unknown
  ): Promise<IProcedureResult<TRow, TOut>> {
    const rows: Array<TRow> = [];
    const outBinds: Record<string, unknown> = {};
    if (
      rawOutBinds === null ||
      typeof rawOutBinds !== 'object' ||
      Array.isArray(rawOutBinds)
    ) {
      if (outBindings.length > 0) {
        throw new ServerError('Oracle out binds must be returned by name');
      }
      return { rows, outBinds: outBinds as TOut };
    }

    const rawRecord = rawOutBinds as Record<string, unknown>;
    const rawKeys = this.indexOutputKeys(rawRecord);
    const cursorSet = new Set(cursorsNames);
    const tracker = new ProcedureResourceTracker(
      'Oracle',
      this.options.resourceLimits ?? DEFAULT_RESOURCE_LIMITS
    );
    const { resultSets: pendingResultSets, lobs: pendingLobs } =
      this.getPendingResources<TRow>(Object.values(rawRecord));
    try {
      for (const outBinding of outBindings) {
        const outputName = this.options.caseStrategy.transformColumnName(
          outBinding.name
        );
        const rawKey = rawKeys.get(outBinding.name.toLowerCase());
        let rawValue: unknown = rawRecord[rawKey ?? outBinding.name];
        if (outBinding instanceof OracleRecordOutBinding) {
          const record: Record<string, unknown> = {};
          for (const [fieldName, bindName] of outBinding.fieldBindings) {
            const fieldKey = rawKeys.get(bindName.toLowerCase());
            if (fieldKey === undefined)
              throw new ServerError(
                `Oracle RECORD field "${outBinding.name}.${fieldName}" was not returned`
              );
            record[fieldName] = rawRecord[fieldKey];
          }
          rawValue = record;
        }
        if (!cursorSet.has(outBinding.name)) {
          if (outBinding.structuredType) {
            const objectValue = await this.materializeStructuredOut(
              rawValue,
              outBinding,
              outputName
            );
            tracker.addValue(objectValue);
            outBinds[outputName] = objectValue;
            continue;
          }
          const materializedValue = await this.materializeLobValue(rawValue);
          if (this.isLob(rawValue)) pendingLobs.delete(rawValue);
          const scalarValue = this.serializeScalarOut(
            outBinding,
            materializedValue,
            outputName
          );
          tracker.addValue(scalarValue);
          outBinds[outputName] = scalarValue;
          continue;
        }
        if (!this.isResultSet<TRow>(rawValue)) {
          throw new ServerError(
            `Oracle cursor "${outBinding.name}" was not returned`
          );
        }

        const metadata = this.getResultSetMetadata(rawValue) ?? [];
        if (metadata.length === 0) {
          this.logger.warn(
            `Oracle cursor "${outBinding.name}" came back without a usable column description, so its rows are returned as the driver produced them, without the duplicate column name check`
          );
        }
        const cursorRows = await this.handleQueryStream<TRow>(
          rawValue.toQueryStream(),
          async (row) => {
            this.trackRowLobs(row, pendingLobs);
            const transformed = await this.transformCursorRow(row, metadata);
            this.untrackRowLobs(row, pendingLobs);
            tracker.addRow(transformed);
            rows.push(transformed);
            return transformed;
          }
        );
        pendingResultSets.delete(rawValue);
        outBinds[outputName] = cursorRows;
      }
    } finally {
      await this.closePendingResultSets(pendingResultSets);
      this.destroyPendingLobs(pendingLobs);
    }
    return { rows, outBinds: outBinds as TOut };
  }

  private indexOutputKeys(
    outputRecord: Record<string, unknown>
  ): ReadonlyMap<string, string> {
    const keys = new Map<string, string>();
    for (const key of Object.keys(outputRecord)) {
      const normalized = key.toLowerCase();
      if (!keys.has(normalized)) keys.set(normalized, key);
    }
    return keys;
  }

  private isResultSet<T>(value: unknown): value is oracledb.ResultSet<T> {
    return (
      value !== null &&
      typeof value === 'object' &&
      'toQueryStream' in value &&
      typeof value.toQueryStream === 'function' &&
      'close' in value &&
      typeof value.close === 'function'
    );
  }

  private getPendingResources<T>(values: Iterable<unknown>): {
    resultSets: Set<oracledb.ResultSet<T>>;
    lobs: Set<oracledb.Lob>;
  } {
    const resultSets = new Set<oracledb.ResultSet<T>>();
    const lobs = new Set<oracledb.Lob>();
    for (const value of values) {
      if (this.isResultSet<T>(value)) resultSets.add(value);
      else if (this.isLob(value)) lobs.add(value);
    }
    return { resultSets, lobs };
  }

  /**
   * Registers the LOB handles of one cursor row as pending resources.
   *
   * Only top-level out binds are registered when the call starts, so a LOB
   * that arrives inside a cursor row is unknown to the cleanup path until this
   * runs. Without it, a column that throws part-way through a row — the name
   * collision check, `resourceLimits.maxLobBytes`, a tracker limit — leaves
   * every handle of that row that had not been drained yet open until the
   * pool closes the connection.
   * @param row - one row as the driver produced it.
   * @param pendingLobs - the set the cleanup path destroys.
   */
  private trackRowLobs(row: unknown, pendingLobs: Set<oracledb.Lob>): void {
    for (const value of this.readRowValues(row)) {
      if (this.isLob(value)) pendingLobs.add(value);
    }
  }

  /**
   * Drops a fully materialized row's LOB handles from the pending set.
   * `materializeLobValue` has already destroyed each of them, so keeping them
   * would only grow the set for the lifetime of the call.
   * @param row - the row whose handles were all drained.
   * @param pendingLobs - the set the cleanup path destroys.
   */
  private untrackRowLobs(row: unknown, pendingLobs: Set<oracledb.Lob>): void {
    for (const value of this.readRowValues(row)) {
      if (this.isLob(value)) pendingLobs.delete(value);
    }
  }

  /** Reads a row's values, whichever `outFormat` the driver produced it in. */
  private readRowValues(row: unknown): Array<unknown> {
    if (row === null || typeof row !== 'object') return [];
    return Array.isArray(row)
      ? (row as Array<unknown>)
      : Object.values(row as Record<string, unknown>);
  }

  private async closePendingResultSets<T>(
    resultSets: ReadonlySet<oracledb.ResultSet<T>>
  ): Promise<void> {
    for (const resultSet of resultSets) {
      try {
        await resultSet.close();
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to close Oracle result set: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private destroyPendingLobs(lobs: ReadonlySet<oracledb.Lob>): void {
    for (const lob of lobs) {
      this.destroyLob(lob);
    }
  }

  private destroyLob(lob: oracledb.Lob): void {
    try {
      if (!lob.destroyed) lob.destroy();
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to destroy Oracle LOB: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async handleQueryStream<T>(
    stream: oracledb.QueryStream<T>,
    transformRow: (row: T) => T | Promise<T>
  ): Promise<Array<T>> {
    const results: Array<T> = [];
    try {
      for await (const row of stream as AsyncIterable<T>) {
        results.push(await transformRow(row));
      }
    } finally {
      if (!stream.destroyed) stream.destroy();
    }
    return results;
  }

  /**
   * Reads a result set's column description, if it has a usable one.
   *
   * Returning `undefined` rather than an empty array keeps "the driver could
   * not describe this result set" apart from "the driver described no
   * columns", so the caller can say which one it is degrading on instead of
   * degrading in silence, which is what hid the loss of the duplicate column
   * name check the README promises.
   * @param resultSet - the REF CURSOR result set to describe.
   * @returns the column metadata, or undefined when it is missing or unusable.
   */
  private getResultSetMetadata<T>(
    resultSet: oracledb.ResultSet<T>
  ): Array<oracledb.Metadata<T>> | undefined {
    const candidate = resultSet as unknown;
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      !('metaData' in candidate) ||
      !Array.isArray(candidate.metaData) ||
      !candidate.metaData.every(
        (metadata: unknown) =>
          metadata !== null &&
          typeof metadata === 'object' &&
          'name' in metadata &&
          typeof metadata.name === 'string'
      )
    ) {
      return undefined;
    }
    return candidate.metaData as Array<oracledb.Metadata<T>>;
  }

  /**
   * Turns one row of a REF CURSOR into the row the caller receives.
   *
   * Naming and serialization of cursor columns belong to node-oracledb's fetch
   * type handler, which this package installs on the driver. The handler runs
   * for a nested REF CURSOR result set exactly as it runs for a plain query
   * (`ResultSetImpl._setup` is given the same execute options), so by the time
   * a row reaches this method its column names have already been through the
   * case strategy and its values through the registered serializer. Doing
   * either again is not a no-op: a strategy that does not map its own output
   * onto itself corrupts the name (`A_B_C` -> `aBC` -> `aBc`, so a cursor
   * column ended up named differently from the same column in a plain query),
   * and a second serializer pass hands a strategy a value it already produced,
   * which the native-value assertion rejects outright for anything but a
   * string or a Date.
   *
   * What is left is what the driver does not do: LOB handles are drained into
   * values, and two columns arriving under one name are rejected instead of
   * overwriting each other.
   * @param row - the row as the driver produced it, keyed or positional.
   * @param metadata - the result set columns, in fetch order.
   * @returns the row keyed by output column name.
   * @throws ServerError - when two columns share one output name.
   */
  private async transformCursorRow<T>(
    row: T,
    metadata: Array<oracledb.Metadata<T>>
  ): Promise<T> {
    if (row === null || typeof row !== 'object') return row;
    if (metadata.length === 0) {
      if (Array.isArray(row)) {
        return (await Promise.all(
          row.map((value) => this.materializeLobValue(value))
        )) as T;
      }
      const passthrough: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(
        row as Record<string, unknown>
      )) {
        passthrough[name] = await this.materializeLobValue(value);
      }
      return passthrough as T;
    }

    const transformed: Record<string, unknown> = {};
    const outputNames = new Set<string>();
    const rowArray = Array.isArray(row) ? (row as Array<unknown>) : undefined;
    const rowRecord = rowArray ? undefined : (row as Record<string, unknown>);
    for (const [index, column] of metadata.entries()) {
      const outputName = column.name;
      if (rowRecord && !(outputName in rowRecord)) continue;
      if (outputNames.has(outputName)) {
        throw new ServerError(
          `Oracle result set returned two columns named "${outputName}"`
        );
      }
      outputNames.add(outputName);
      transformed[outputName] = await this.materializeLobValue(
        rowRecord ? rowRecord[outputName] : rowArray?.[index]
      );
    }
    return transformed as T;
  }

  private isLob(value: unknown): value is oracledb.Lob {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as {
      type?: unknown;
      destroy?: unknown;
      [Symbol.asyncIterator]?: unknown;
    };
    return (
      (candidate.type === oracledb.CLOB ||
        candidate.type === oracledb.BLOB ||
        candidate.type === oracledb.DB_TYPE_CLOB ||
        candidate.type === oracledb.DB_TYPE_BLOB) &&
      typeof candidate.destroy === 'function' &&
      typeof candidate[Symbol.asyncIterator] === 'function'
    );
  }

  private async materializeLobValue(value: unknown): Promise<unknown> {
    if (!this.isLob(value)) return value;
    const isClob =
      value.type === oracledb.CLOB || value.type === oracledb.DB_TYPE_CLOB;
    const chunks: Array<Buffer> = [];
    let totalBytes = 0;
    const maxLobBytes =
      this.options.resourceLimits?.maxLobBytes ??
      DEFAULT_RESOURCE_LIMITS.maxLobBytes;
    try {
      for await (const rawChunk of value as AsyncIterable<unknown>) {
        const chunk = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(
              typeof rawChunk === 'string' ? rawChunk : String(rawChunk)
            );
        totalBytes += chunk.byteLength;
        if (totalBytes > maxLobBytes) {
          throw new ServerError(
            `Oracle LOB exceeds resourceLimits.maxLobBytes (${maxLobBytes})`
          );
        }
        chunks.push(chunk);
      }
    } finally {
      this.destroyLob(value);
    }
    const contents = Buffer.concat(chunks);
    return isClob ? contents.toString('utf8') : contents;
  }

  private serializeScalarOut(
    outBinding: IProcedureOutBinding,
    value: unknown,
    outputName: string
  ): unknown {
    const serializerType = this.getSerializerType(outBinding.databaseType);
    if (!serializerType) return value;
    return this.serializer.serializeValue(serializerType, value, {
      source: 'scalar-out',
      database: 'oracle',
      name: outputName,
      databaseType: outBinding.databaseType,
    });
  }

  private async materializeStructuredOut(
    value: unknown,
    outBinding: IProcedureOutBinding,
    outputName: string
  ): Promise<Record<string, unknown> | null> {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ServerError(
        `Oracle RECORD "${outBinding.name}" was not returned as an object`
      );
    }
    const structuredType = outBinding.structuredType;
    if (structuredType?.kind !== 'oracle-record') {
      throw new ServerError(
        `Oracle RECORD "${outBinding.name}" has invalid structured metadata`
      );
    }

    const record = value as Record<string, unknown>;
    this.assertStructuredOutputFields(
      record,
      structuredType.fields,
      outBinding.name
    );
    const keys = this.indexOutputKeys(record);
    const materialized: Record<string, unknown> = {};
    for (const field of structuredType.fields) {
      const fieldOutputName = this.options.caseStrategy.transformColumnName(
        field.name
      );
      if (Object.hasOwn(materialized, fieldOutputName)) {
        throw new ServerError(
          `Oracle RECORD "${outBinding.name}" has conflicting transformed field "${fieldOutputName}"`
        );
      }
      const rawKey = keys.get(field.name.toLowerCase());
      let rawFieldValue: unknown = null;
      if (field.name in record) rawFieldValue = record[field.name];
      else if (rawKey !== undefined) rawFieldValue = record[rawKey];
      if (Array.isArray(rawFieldValue)) {
        throw new ServerError(
          `Oracle RECORD field "${outBinding.name}.${field.name}" returned an unsupported array`
        );
      }
      const fieldValue = await this.materializeLobValue(rawFieldValue);
      const serializerType = this.getSerializerType(field.argumentType);
      materialized[fieldOutputName] = serializerType
        ? this.serializer.serializeValue(serializerType, fieldValue, {
            source: 'scalar-out',
            database: 'oracle',
            name: `${outputName}.${fieldOutputName}`,
            databaseType: field.argumentType,
          })
        : fieldValue;
    }
    return materialized;
  }

  private assertStructuredOutputFields(
    record: Record<string, unknown>,
    fields: Array<IProcedureStructuredField>,
    bindingName: string
  ): void {
    const expectedNames = new Set(fields.map(({ name }) => name.toLowerCase()));
    const returnedNames = this.getStructuredOutputFieldNames(record);
    const seenNames = new Set<string>();
    const unexpectedNames: Array<string> = [];

    for (const name of returnedNames) {
      const normalizedName = name.toLowerCase();
      if (seenNames.has(normalizedName)) {
        throw new ServerError(
          `Oracle RECORD "${bindingName}" returned conflicting field "${name}"`
        );
      }
      seenNames.add(normalizedName);
      if (!expectedNames.has(normalizedName)) unexpectedNames.push(name);
    }

    if (unexpectedNames.length > 0) {
      throw new ServerError(
        `Oracle RECORD "${bindingName}" returned unknown fields: ${unexpectedNames.sort().join(', ')}`
      );
    }
  }

  private getStructuredOutputFieldNames(
    record: Record<string, unknown>
  ): Array<string> {
    const attributes = record.attributes;
    if (
      typeof record.fqn === 'string' &&
      typeof record.copy === 'function' &&
      record.isCollection === false &&
      attributes !== null &&
      typeof attributes === 'object' &&
      !Array.isArray(attributes)
    ) {
      return Object.keys(attributes);
    }
    return Object.keys(record);
  }

  /**
   * Picks the serializer for an Oracle OUT bind, by its dictionary type name.
   *
   * One mapping serves every OUT bind the materializer touches — a scalar OUT
   * and a field of a PL/SQL RECORD alike — because the value a procedure hands
   * back through `p_flag OUT BOOLEAN` and the value it hands back through
   * `p_row.flag` are the same value, and a consumer that registered a BOOLEAN
   * serializer expects both to go through it. Keeping two lists is what let a
   * scalar `BOOLEAN`, `CHAR` or `RAW` OUT come back raw while the identical
   * RECORD field was serialized.
   *
   * `PL/SQL BOOLEAN` is how the data dictionary names a BOOLEAN before Oracle
   * Database 23ai made it a SQL type, so both names map to BOOLEAN. A `BLOB`
   * OUT has already been drained into a Buffer when it gets here, so it goes
   * through BINARY like `RAW`, as a fetched BLOB column does.
   *
   * `JSON` is reachable only as a RECORD field: the scalar argument whitelist
   * in `OracleProcedureBindings` rejects a JSON argument, but the fields of a
   * RECORD bound through its object type are not checked against that list.
   * `XMLTYPE` has no entry, since the whitelist rejects it as an argument.
   *
   * Cursor columns are deliberately absent: those are fetch-path values, and
   * node-oracledb has already run the registered serializer on them through
   * the fetch type handler by the time a row reaches this class.
   * @param databaseType - dictionary type name, in any case.
   * @returns the serializer to apply, or undefined when none covers the type.
   */
  private getSerializerType(
    databaseType: string | undefined
  ): TSerializerType | undefined {
    switch (databaseType?.toUpperCase()) {
      case 'DATE':
        return 'DATE';
      case 'TIMESTAMP':
        return 'TIMESTAMP';
      case 'TIMESTAMP WITH TIME ZONE':
        return 'TIMESTAMP_TZ';
      case 'TIMESTAMP WITH LOCAL TIME ZONE':
        return 'TIMESTAMP_LTZ';
      case 'BOOLEAN':
      case 'PL/SQL BOOLEAN':
        return 'BOOLEAN';
      case 'CHAR':
      case 'NCHAR':
        return 'CHAR';
      case 'VARCHAR':
      case 'VARCHAR2':
      case 'NVARCHAR2':
        return 'VARCHAR';
      case 'JSON':
        return 'JSON';
      case 'RAW':
      case 'BLOB':
        return 'BINARY';
      default:
        return undefined;
    }
  }
}
