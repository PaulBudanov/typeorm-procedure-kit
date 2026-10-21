import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';

import type {
  IProcedureStructuredField,
  IProcedureStructuredType,
} from '../../types/procedure.types.js';

/**
 * Folds the flat Oracle data-dictionary rows of one package into the row shape
 * the kit's vendor-neutral metadata decoder consumes.
 *
 * `ALL_ARGUMENTS`/`ALL_PLSQL_TYPE_ATTRS` report a PL/SQL RECORD argument as a
 * `DATA_LEVEL = 0` parent row followed by one `DATA_LEVEL = 1` row per field,
 * so the parser walks the rows in order, attaches each field to the RECORD it
 * belongs to and rejects everything the kit cannot bind: collections, nested
 * RECORDs, `%ROWTYPE`, unsupported field types and field rows with no parent.
 * PostgreSQL needs no equivalent because its dictionary query already returns
 * composite types assembled.
 *
 * Every rejection message is part of the public contract -- callers see it when
 * their package signature is unsupported -- and the row-scoped ones carry the
 * one-based dictionary row number (`... metadata row 3 ...`).
 */
export class OracleRecordMetadataParser {
  /** Object attribute metadata abbreviates time zones, unlike ALL_ARGUMENTS. */
  private static readonly RECORD_FIELD_TYPE_ALIASES = new Map([
    ['TIMESTAMP WITH TZ', 'TIMESTAMP WITH TIME ZONE'],
    ['TIMESTAMP WITH LOCAL TZ', 'TIMESTAMP WITH LOCAL TIME ZONE'],
  ]);
  private static readonly UNSUPPORTED_RECORD_FIELD_TYPES = new Set([
    'BFILE',
    'BLOB',
    'CLOB',
    'NCLOB',
    'OBJECT',
    'PL/SQL RECORD',
    'PL/SQL TABLE',
    'REF CURSOR',
    'TABLE',
    'VARRAY',
  ]);

  /**
   * @param assertRecordVersionSupport - gate invoked before each RECORD row is
   * accepted. It stays on the adapter because it reads the connected server and
   * Oracle Client versions -- the same predicate the adapter needs to pick its
   * dictionary SQL -- and because the binding path applies the very same gate.
   */
  public constructor(private readonly assertRecordVersionSupport: () => void) {}

  /**
   * Combines a package RECORD argument with its dictionary field rows.
   * @param rows - dictionary rows in `DATA_LEVEL`/`SEQUENCE` order.
   * @returns one row per argument, RECORD rows carrying their structured type.
   */
  public prepareRows(
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    const preparedRows: Array<Record<string, unknown>> = [];
    let activeRecord: IProcedureStructuredType | undefined;

    for (const [index, row] of rows.entries()) {
      if (!Object.hasOwn(row, 'dataLevel')) {
        preparedRows.push(row);
        activeRecord = undefined;
        continue;
      }

      const dataLevel = this.readMetadataInteger(row.dataLevel, index, {
        name: 'dataLevel',
        minimum: 0,
      });
      if (dataLevel === 0) {
        activeRecord = undefined;
        const argumentType = this.readMetadataString(
          row.argumentType,
          index,
          'argumentType'
        ).toUpperCase();
        if (this.isCollectionType(argumentType, row.plsqlTypecode)) {
          throw new ServerError(
            `Oracle collection argument at metadata row ${index + 1} is not supported`
          );
        }
        if (!this.isRecordType(row)) {
          preparedRows.push(row);
          continue;
        }

        this.assertRecordVersionSupport();
        activeRecord = this.createRecordMetadata(row, index);
        preparedRows.push({ ...row, size: null, structuredType: activeRecord });
        continue;
      }

      if (!activeRecord) {
        throw new ServerError(
          `Oracle nested argument metadata row ${index + 1} has no package RECORD parent`
        );
      }
      if (dataLevel !== 1) {
        throw new ServerError(
          `Oracle nested RECORD fields are not supported (metadata row ${index + 1})`
        );
      }
      activeRecord.fields.push(this.createRecordFieldMetadata(row, index));
    }

    this.assertRecordsHaveFields(preparedRows);
    return preparedRows;
  }

  /** Rejects RECORD arguments whose field rows never arrived. */
  private assertRecordsHaveFields(
    preparedRows: Array<Record<string, unknown>>
  ): void {
    for (const [index, row] of preparedRows.entries()) {
      const structuredType = row.structuredType;
      if (
        structuredType !== null &&
        typeof structuredType === 'object' &&
        !Array.isArray(structuredType) &&
        (structuredType as { kind?: unknown }).kind === 'oracle-record' &&
        (structuredType as IProcedureStructuredType).fields.length === 0
      ) {
        throw new ServerError(
          `Oracle package RECORD at prepared metadata row ${index + 1} has no fields`
        );
      }
    }
  }

  private createRecordMetadata(
    row: Record<string, unknown>,
    index: number
  ): IProcedureStructuredType {
    const owner = this.readMetadataString(row.typeOwner, index, 'typeOwner');
    const packageName = this.readMetadataString(
      row.typeName,
      index,
      'typeName'
    );
    const typeName = this.readMetadataString(
      row.typeSubname,
      index,
      'typeSubname'
    );
    if (
      owner.includes('%ROWTYPE') ||
      packageName.includes('%ROWTYPE') ||
      typeName.includes('%ROWTYPE')
    ) {
      throw new ServerError(
        'Oracle PL/SQL %ROWTYPE arguments are not supported'
      );
    }
    SqlIdentifier.validateIdentifier(owner, 'oracle record owner');
    SqlIdentifier.validateIdentifier(packageName, 'oracle record package');
    SqlIdentifier.validateIdentifier(typeName, 'oracle record type');
    return {
      kind: 'oracle-record',
      owner,
      packageName,
      typeName,
      fields: [],
    };
  }

  private createRecordFieldMetadata(
    row: Record<string, unknown>,
    index: number
  ): IProcedureStructuredField {
    const name = this.readMetadataString(
      row.argumentName,
      index,
      'argumentName'
    );
    const dictionaryType = this.readMetadataString(
      row.argumentType,
      index,
      'argumentType'
    ).toUpperCase();
    const argumentType =
      OracleRecordMetadataParser.RECORD_FIELD_TYPE_ALIASES.get(
        dictionaryType
      ) ?? dictionaryType;
    const order = this.readMetadataInteger(row.sequence, index, {
      name: 'sequence',
      minimum: 0,
    });
    SqlIdentifier.validateIdentifier(name, 'oracle record field');
    if (
      OracleRecordMetadataParser.UNSUPPORTED_RECORD_FIELD_TYPES.has(
        argumentType
      ) ||
      argumentType.includes('%ROWTYPE') ||
      row.typeOwner != null ||
      row.typeName != null ||
      row.typeSubname != null
    ) {
      throw new ServerError(
        `Oracle RECORD field "${name}" uses unsupported type ${argumentType}`
      );
    }
    return { name, argumentType, order };
  }

  private isRecordType(row: Record<string, unknown>): boolean {
    const typeCode =
      typeof row.plsqlTypecode === 'string'
        ? row.plsqlTypecode.trim().toUpperCase()
        : undefined;
    return typeCode === 'PL/SQL RECORD' || typeCode === 'RECORD';
  }

  private isCollectionType(
    argumentType: string,
    rawTypeCode: unknown
  ): boolean {
    const typeCode =
      typeof rawTypeCode === 'string'
        ? rawTypeCode.trim().toUpperCase()
        : undefined;
    return (
      typeCode === 'COLLECTION' ||
      argumentType === 'PL/SQL TABLE' ||
      argumentType === 'TABLE' ||
      argumentType === 'VARRAY'
    );
  }

  private readMetadataString(
    value: unknown,
    index: number,
    name: string
  ): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ServerError(
        `Invalid Oracle metadata row ${index + 1}: ${name} must be a non-empty string`
      );
    }
    return value.trim();
  }

  private readMetadataInteger(
    value: unknown,
    index: number,
    options: { name: string; minimum: number }
  ): number {
    const parsed =
      typeof value === 'number' ||
      (typeof value === 'string' && value.trim().length > 0)
        ? Number(value)
        : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < options.minimum) {
      throw new ServerError(
        `Invalid Oracle metadata row ${index + 1}: ${options.name} must be a safe integer greater than or equal to ${options.minimum}`
      );
    }
    return parsed;
  }
}
