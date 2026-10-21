import { StringDecoder } from 'string_decoder';

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

/** A UTF-16 surrogate code unit that is not half of a surrogate pair. */
const LONE_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

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

  /**
   * Drains a LOB handle into its value and destroys the handle, whether the
   * drain succeeds or fails part-way through.
   * @param value - any value; only a CLOB or BLOB handle is drained.
   * @returns a string for a CLOB, a Buffer for a BLOB, anything else as is.
   * @throws ServerError - when the LOB is larger than
   *   `resourceLimits.maxLobBytes`.
   */
  private async materializeLobValue(value: unknown): Promise<unknown> {
    if (!this.isLob(value)) return value;
    const maxLobBytes =
      this.options.resourceLimits?.maxLobBytes ??
      DEFAULT_RESOURCE_LIMITS.maxLobBytes;
    try {
      return value.type === oracledb.CLOB ||
        value.type === oracledb.DB_TYPE_CLOB
        ? await this.drainClob(value, maxLobBytes)
        : await this.drainBlob(value, maxLobBytes);
    } finally {
      this.destroyLob(value);
    }
  }

  /**
   * Reads a CLOB into one string.
   *
   * The pieces stay text until they are joined: a piece boundary can fall
   * between the two halves of a surrogate pair, and encoding each piece on
   * its own turned both halves into U+FFFD. A Buffer piece goes through one
   * UTF-8 decoder, so a character split across Buffer pieces survives too.
   *
   * `totalBytes` is the UTF-8 length of the text read so far, kept
   * incrementally: `Buffer.byteLength` of each piece, which counts a lone
   * surrogate as the three bytes of U+FFFD, less two bytes where a high
   * surrogate that ended the previous piece meets a low surrogate that starts
   * this one, since the pair is one four-byte character. Measuring the joined
   * text after every piece instead would be quadratic in the LOB size.
   *
   * A surrogate no piece completes is replaced with U+FFFD, as the per-piece
   * encoding did, so the result is well-formed and its UTF-8 length is the
   * count the limit was checked against.
   * @param lob - the CLOB handle; the caller destroys it.
   * @param maxLobBytes - the most UTF-8 bytes the text may take.
   * @returns the CLOB contents.
   * @throws ServerError - when the text is longer than `maxLobBytes`.
   */
  private async drainClob(
    lob: oracledb.Lob,
    maxLobBytes: number
  ): Promise<string> {
    this.requestTextChunks(lob);
    const decoder = new StringDecoder('utf8');
    const parts: Array<string> = [];
    let totalBytes = 0;
    let hasTrailingHighSurrogate = false;
    for await (const rawChunk of lob as AsyncIterable<unknown>) {
      if (Buffer.isBuffer(rawChunk)) {
        totalBytes += rawChunk.byteLength;
        parts.push(decoder.write(rawChunk));
        hasTrailingHighSurrogate = false;
      } else {
        const text = typeof rawChunk === 'string' ? rawChunk : String(rawChunk);
        const pendingText = decoder.end();
        if (pendingText !== '') parts.push(pendingText);
        parts.push(text);
        totalBytes += Buffer.byteLength(text);
        if (
          hasTrailingHighSurrogate &&
          this.isLowSurrogate(text.charCodeAt(0))
        ) {
          totalBytes -= 2;
        }
        if (text.length > 0) {
          hasTrailingHighSurrogate = this.isHighSurrogate(
            text.charCodeAt(text.length - 1)
          );
        }
      }
      this.assertLobWithinLimit(totalBytes, maxLobBytes);
    }
    parts.push(decoder.end());
    return parts.join('').replace(LONE_SURROGATE_PATTERN, '\uFFFD');
  }

  /**
   * Reads a BLOB into one Buffer, counting its bytes as they arrive.
   * @param lob - the BLOB handle; the caller destroys it.
   * @param maxLobBytes - the most bytes the contents may take.
   * @returns the BLOB contents.
   * @throws ServerError - when the contents are longer than `maxLobBytes`.
   */
  private async drainBlob(
    lob: oracledb.Lob,
    maxLobBytes: number
  ): Promise<Buffer> {
    const chunks: Array<Buffer> = [];
    let totalBytes = 0;
    for await (const rawChunk of lob as AsyncIterable<unknown>) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(
            typeof rawChunk === 'string' ? rawChunk : String(rawChunk)
          );
      totalBytes += chunk.byteLength;
      this.assertLobWithinLimit(totalBytes, maxLobBytes);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Has a CLOB stream hand its pieces over as the strings it read.
   *
   * node-oracledb's `Lob` pushes each piece it reads into its Readable side
   * as a string (`Lob._read`), and a Readable with no encoding set turns every
   * pushed string into a Buffer on its own, which replaces a surrogate left
   * unpaired at the end of a piece with U+FFFD before this class sees it. With
   * `utf8` set the strings come through unchanged. A LOB stand-in without
   * `setEncoding` is read as it is.
   * @param lob - the CLOB handle, not read from yet.
   */
  private requestTextChunks(lob: oracledb.Lob): void {
    const candidate = lob as { setEncoding?: unknown };
    if (typeof candidate.setEncoding === 'function') lob.setEncoding('utf8');
  }

  private isHighSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
  }

  private isLowSurrogate(codeUnit: number): boolean {
    return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
  }

  private assertLobWithinLimit(totalBytes: number, maxLobBytes: number): void {
    if (totalBytes > maxLobBytes) {
      throw new ServerError(
        `Oracle LOB exceeds resourceLimits.maxLobBytes (${maxLobBytes})`
      );
    }
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
