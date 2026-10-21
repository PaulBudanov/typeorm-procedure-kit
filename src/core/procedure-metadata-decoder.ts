import { DEFAULT_RESOURCE_LIMITS } from '../utils/resource-limits.js';
import { ServerError } from '../utils/server-error.js';

import type {
  IProcedureArgumentBase,
  IProcedureStructuredField,
  IProcedureStructuredType,
  TProcedureArgumentMode,
} from '../types/procedure.types.js';

/**
 * Validates and decodes a single vendor-prepared procedure metadata row into the
 * strongly typed argument shape the rest of the kit consumes.
 *
 * Every rejection message is part of the public contract: callers see them when
 * their database metadata is malformed, so they encode either the one-based row
 * number (`Invalid procedure metadata row 3: ...`) or the structured path
 * (`Invalid procedure metadata row 3: structuredType.fields[0].name ...`).
 */
export class ProcedureMetadataDecoder {
  public constructor(
    private readonly maxMetadataRows: number = DEFAULT_RESOURCE_LIMITS.maxMetadataRows
  ) {}

  /**
   * Decodes one prepared metadata row.
   * @param value - raw row produced by the vendor preparation hook
   * @param index - zero-based row index, reported as `index + 1` in errors
   */
  public decodeProcedureArgument(
    value: unknown,
    index: number
  ): IProcedureArgumentBase {
    const prefix = ProcedureMetadataDecoder.rowPrefix(index);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ServerError(`${prefix} expected an object`);
    }
    const record = value as Record<string, unknown>;
    const reference = ProcedureMetadataDecoder.rowReference(index);

    const mode = this.decodeMode(record, prefix, reference);

    const order = this.readInteger(
      record,
      'order',
      reference,
      'non-negative',
      'invalid'
    );
    if (order === undefined) {
      throw new ServerError(
        `${reference('order')} must be a non-negative safe integer`
      );
    }

    const size = this.readInteger(record, 'size', reference, 'positive');
    const subprogramId = this.readInteger(
      record,
      'subprogramId',
      reference,
      'positive'
    );

    const specificName = this.readString(
      record,
      'specificName',
      reference,
      'must be a non-empty string when provided'
    );
    const owner = this.readString(
      record,
      'owner',
      reference,
      'must be a non-empty string when provided'
    );
    const overload = this.readString(
      record,
      'overload',
      reference,
      'must be a non-empty string when provided'
    );
    const structuredType = this.decodeStructuredType(
      record.structuredType,
      index
    );

    return {
      procedureName: this.readRequiredString(
        record,
        'procedureName',
        reference
      ),
      argumentName: this.readRequiredString(record, 'argumentName', reference),
      argumentType: this.readRequiredString(record, 'argumentType', reference),
      order,
      mode,
      ...(size === undefined ? {} : { size }),
      ...(specificName === undefined ? {} : { specificName }),
      ...(owner === undefined ? {} : { owner }),
      ...(subprogramId === undefined ? {} : { subprogramId }),
      ...(overload === undefined ? {} : { overload }),
      ...(structuredType === undefined ? {} : { structuredType }),
    };
  }

  private decodeMode(
    record: Record<string, unknown>,
    prefix: string,
    reference: (key: string) => string
  ): TProcedureArgumentMode {
    const rawMode = this.readRequiredString(record, 'mode', reference)
      .toUpperCase()
      .replaceAll(' ', '');
    if (rawMode === 'IN') return 'IN';
    if (rawMode === 'OUT') return 'OUT';
    if (rawMode === 'INOUT' || rawMode === 'IN/OUT') return 'IN/OUT';
    throw new ServerError(`${prefix} unsupported mode ${rawMode}`);
  }

  private decodeStructuredType(
    value: unknown,
    rowIndex: number
  ): IProcedureStructuredType | undefined {
    if (value === undefined || value === null) return undefined;
    const path = `${ProcedureMetadataDecoder.rowPrefix(rowIndex)} structuredType`;
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ServerError(`${path} must be an object when provided`);
    }
    const record = value as Record<string, unknown>;
    const reference = ProcedureMetadataDecoder.pathReference(path);
    const kind = record.kind;
    if (kind !== 'oracle-record' && kind !== 'postgres-composite') {
      throw new ServerError(`${path}.kind is unsupported`);
    }
    const typeName = this.readRequiredString(
      record,
      'typeName',
      reference,
      'is required'
    );
    const rawFields = record.fields;
    if (!Array.isArray(rawFields) || rawFields.length === 0) {
      throw new ServerError(`${path}.fields must be a non-empty array`);
    }
    if (rawFields.length > this.maxMetadataRows) {
      throw new ServerError(
        `${path}.fields exceeds resourceLimits.maxMetadataRows (${this.maxMetadataRows})`
      );
    }
    const fields = rawFields.map((field, fieldIndex) =>
      this.decodeStructuredField(field, `${path}.fields[${fieldIndex}]`)
    );
    const orders = new Set<number>();
    const names = new Set<string>();
    for (const field of fields) {
      const normalizedName = field.name.toLowerCase();
      if (names.has(normalizedName) || orders.has(field.order)) {
        throw new ServerError(
          `${path}.fields must have unique names and order`
        );
      }
      names.add(normalizedName);
      orders.add(field.order);
    }
    fields.sort((left, right) => left.order - right.order);
    const typeOid = this.readInteger(
      record,
      'typeOid',
      reference,
      'non-negative'
    );
    return {
      kind,
      typeName,
      fields,
      ...this.readOptionalNames(record, reference),
      ...(typeOid === undefined ? {} : { typeOid }),
    };
  }

  private decodeStructuredField(
    value: unknown,
    path: string
  ): IProcedureStructuredField {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ServerError(`${path} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const reference = ProcedureMetadataDecoder.pathReference(path);
    const order = this.readInteger(record, 'order', reference, 'non-negative');
    if (order === undefined) {
      throw new ServerError(`${reference('order')} is required`);
    }
    const typeOid = this.readInteger(
      record,
      'typeOid',
      reference,
      'non-negative'
    );
    const typeName = this.readString(record, 'typeName', reference);
    return {
      name: this.readRequiredString(record, 'name', reference, 'is required'),
      argumentType: this.readRequiredString(
        record,
        'argumentType',
        reference,
        'is required'
      ),
      order,
      ...this.readOptionalNames(record, reference),
      ...(typeName === undefined ? {} : { typeName }),
      ...(typeOid === undefined ? {} : { typeOid }),
    };
  }

  private readOptionalNames(
    record: Record<string, unknown>,
    reference: (key: string) => string
  ): Pick<IProcedureStructuredType, 'owner' | 'schema' | 'packageName'> {
    const owner = this.readString(record, 'owner', reference);
    const schema = this.readString(record, 'schema', reference);
    const packageName = this.readString(record, 'packageName', reference);
    return {
      ...(owner === undefined ? {} : { owner }),
      ...(schema === undefined ? {} : { schema }),
      ...(packageName === undefined ? {} : { packageName }),
    };
  }

  /**
   * Reads an optional trimmed non-empty string.
   * @param reference - renders `<where>.<key>` (or `<row prefix> <key>`) for errors
   * @param invalid - tail of the message thrown for a present but unusable value
   */
  private readString(
    record: Record<string, unknown>,
    key: string,
    reference: (key: string) => string,
    invalid:
      | 'must be a non-empty string'
      | 'must be a non-empty string when provided' = 'must be a non-empty string'
  ): string | undefined {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ServerError(`${reference(key)} ${invalid}`);
    }
    return value.trim();
  }

  /**
   * Reads a mandatory trimmed non-empty string.
   * @param missing - tail of the message thrown when the key is absent or null
   */
  private readRequiredString(
    record: Record<string, unknown>,
    key: string,
    reference: (key: string) => string,
    missing:
      | 'is required'
      | 'must be a non-empty string' = 'must be a non-empty string'
  ): string {
    const value = this.readString(record, key, reference);
    if (value === undefined) {
      throw new ServerError(`${reference(key)} ${missing}`);
    }
    return value;
  }

  /**
   * Reads an optional safe integer coerced from a number or numeric string.
   * @param bound - lower bound the value must satisfy, also named in the error
   * @param blankString - whether a whitespace-only string coerces to zero or is rejected
   */
  private readInteger(
    record: Record<string, unknown>,
    key: string,
    reference: (key: string) => string,
    bound: 'non-negative' | 'positive',
    blankString: 'zero' | 'invalid' = 'zero'
  ): number | undefined {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    const isRejectedBlank =
      blankString === 'invalid' &&
      typeof value === 'string' &&
      value.trim().length === 0;
    const parsed =
      !isRejectedBlank &&
      (typeof value === 'number' || typeof value === 'string')
        ? Number(value)
        : Number.NaN;
    const isInBound =
      Number.isSafeInteger(parsed) &&
      (bound === 'positive' ? parsed > 0 : parsed >= 0);
    if (!isInBound) {
      throw new ServerError(
        `${reference(key)} must be a ${bound} safe integer`
      );
    }
    return parsed;
  }

  /** Message prefix naming the one-based metadata row. */
  private static rowPrefix(index: number): string {
    return `Invalid procedure metadata row ${index + 1}:`;
  }

  /** Renders `<row prefix> <key>` for row-level field errors. */
  private static rowReference(index: number): (key: string) => string {
    return (key: string): string =>
      `${ProcedureMetadataDecoder.rowPrefix(index)} ${key}`;
  }

  /** Renders `<path>.<key>` for structured-metadata field errors. */
  private static pathReference(path: string): (key: string) => string {
    return (key: string): string => `${path}.${key}`;
  }
}
