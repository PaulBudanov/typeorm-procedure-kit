import oracledb from 'oracledb';

import { DEFAULT_RESOURCE_LIMITS } from '../../utils/resource-limits.js';
import { ServerError } from '../../utils/server-error.js';
import { ProcedureResourceTracker } from '../abstract/procedure-resource-tracker.js';

import type { IOracleValueSerializer } from '../../interfaces/oracle-result-materializer.interfaces.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type { IProcedureStructuredField } from '../../types/procedure.types.js';
import type {
  TSerializerType,
  TTemporalSerializerType,
} from '../../types/serializer.types.js';
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
        const rawValue = rawRecord[rawKey ?? outBinding.name];
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

        const metadata = this.getResultSetMetadata(rawValue);
        const cursorRows = await this.handleQueryStream<TRow>(
          rawValue.toQueryStream(),
          async (row) => {
            const transformed = await this.transformCursorRow(row, metadata);
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

  private getResultSetMetadata<T>(
    resultSet: oracledb.ResultSet<T>
  ): Array<oracledb.Metadata<T>> {
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
      return [];
    }
    return candidate.metaData as Array<oracledb.Metadata<T>>;
  }

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
      const transformed: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(
        row as Record<string, unknown>
      )) {
        transformed[name] = await this.materializeLobValue(value);
      }
      return transformed as T;
    }

    const transformed: Record<string, unknown> = {};
    const rowArray = Array.isArray(row) ? (row as Array<unknown>) : undefined;
    const rowRecord = rowArray ? undefined : (row as Record<string, unknown>);
    for (const [index, column] of metadata.entries()) {
      const rawName = column.name;
      if (rowRecord && !(rawName in rowRecord)) continue;
      const outputName = this.options.caseStrategy.transformColumnName(rawName);
      const value = await this.materializeLobValue(
        rowRecord ? rowRecord[rawName] : rowArray?.[index]
      );
      const serializerType = this.getTemporalSerializerType(
        column as oracledb.Metadata<unknown>
      );
      transformed[outputName] = serializerType
        ? this.serializer.serializeValue(serializerType, value, {
            source: 'fetch',
            database: 'oracle',
            name: outputName,
            databaseType:
              column.dbType?.columnTypeName ?? column.dbTypeName ?? 'UNKNOWN',
          })
        : value;
    }
    return transformed as T;
  }

  private getTemporalSerializerType(
    metadata: oracledb.Metadata<unknown>
  ): TTemporalSerializerType | undefined {
    switch (metadata.dbType?.columnTypeName ?? metadata.dbTypeName) {
      case 'DATE':
        return 'DATE';
      case 'TIMESTAMP':
        return 'TIMESTAMP';
      case 'TIMESTAMP WITH TIME ZONE':
        return 'TIMESTAMP_TZ';
      case 'TIMESTAMP WITH LOCAL TIME ZONE':
        return 'TIMESTAMP_LTZ';
      default:
        return undefined;
    }
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
    const serializerType = this.getScalarTemporalSerializerType(
      outBinding.databaseType
    );
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
      const serializerType = this.getRecordSerializerType(field.argumentType);
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

  private getRecordSerializerType(
    databaseType: string
  ): TSerializerType | undefined {
    switch (databaseType.toUpperCase()) {
      case 'DATE':
        return 'DATE';
      case 'TIMESTAMP':
        return 'TIMESTAMP';
      case 'TIMESTAMP WITH TIME ZONE':
        return 'TIMESTAMP_TZ';
      case 'TIMESTAMP WITH LOCAL TIME ZONE':
        return 'TIMESTAMP_LTZ';
      case 'BOOLEAN':
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
        return 'BINARY';
      case 'XMLTYPE':
        return 'XML';
      default:
        return undefined;
    }
  }

  private getScalarTemporalSerializerType(
    databaseType: string | undefined
  ): TTemporalSerializerType | undefined {
    switch (databaseType) {
      case 'DATE':
        return 'DATE';
      case 'TIMESTAMP':
        return 'TIMESTAMP';
      case 'TIMESTAMP WITH TIME ZONE':
        return 'TIMESTAMP_TZ';
      case 'TIMESTAMP WITH LOCAL TIME ZONE':
        return 'TIMESTAMP_LTZ';
      default:
        return undefined;
    }
  }
}
