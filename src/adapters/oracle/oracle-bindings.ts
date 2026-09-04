import oracledb from 'oracledb';

import { DateFormatter } from '../../utils/date-formatter.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';

import type {
  IProcedureStructuredField,
  IProcedureStructuredType,
  TProcedureArgumentList,
  TProcedurePayload,
} from '../../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
} from '../../types/utility.types.js';

/** Builds Oracle PL/SQL bindings without owning execution or result fetching. */
export class OracleProcedureBindings {
  private static readonly CURSOR_TYPE = 'REF CURSOR';
  private static readonly DEFAULT_PLSQL_OUT_MAX_SIZE = 32_767;
  private static readonly MINIMUM_OUT_MAX_SIZE = 201;
  private static readonly BINDING_DIRECTIONS = {
    IN: oracledb.BIND_IN,
    OUT: oracledb.BIND_OUT,
    'IN/OUT': oracledb.BIND_INOUT,
  } as const;
  private readonly typeMapping = {
    NUMBER: oracledb.NUMBER,
    STRING: oracledb.STRING,
    VARCHAR2: oracledb.STRING,
    RAW: oracledb.BUFFER,
    [OracleProcedureBindings.CURSOR_TYPE]: oracledb.CURSOR,
    BUFFER: oracledb.BUFFER,
    DATE: oracledb.DB_TYPE_DATE,
    TIMESTAMP: oracledb.DB_TYPE_TIMESTAMP,
    'TIMESTAMP WITH TIME ZONE': oracledb.DB_TYPE_TIMESTAMP_TZ,
    'TIMESTAMP WITH LOCAL TIME ZONE': oracledb.DB_TYPE_TIMESTAMP_LTZ,
    CLOB: oracledb.CLOB,
    BLOB: oracledb.BLOB,
  } as const;
  private static readonly TEMPORAL_TYPES = new Set([
    'DATE',
    'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE',
    'TIMESTAMP WITH LOCAL TIME ZONE',
  ]);
  private static readonly VARIABLE_SIZE_OUT_TYPES = new Set([
    'STRING',
    'VARCHAR2',
    'RAW',
  ]);
  private static readonly LOB_TYPES = new Set(['CLOB', 'BLOB']);

  public build(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: TProcedurePayload | null
  ): IBindingsObjectReturn {
    const procedureArguments = procedures?.[processName];
    if (!procedureArguments) {
      throw new ServerError(
        `Package "${packageName}" or process "${processName}" not found`
      );
    }
    if (typeof payload === 'string' || typeof payload === 'number') {
      throw new TypeError(
        'Payload for call procedure must be an object or array or undefined or null'
      );
    }

    const bindings: Record<string, oracledb.BindParameter> = {};
    const cursorsNames: Array<string> = [];
    const outBindings: Array<IProcedureOutBinding> = [];
    const placeholders: Array<string> = [];

    for (const [index, argument] of procedureArguments.entries()) {
      SqlIdentifier.validateIdentifier(argument.argumentName, 'oracle bind');
      placeholders.push(`:${argument.argumentName}`);
      const dataType = argument.argumentType.toUpperCase();
      const structuredType = argument.structuredType;
      if (structuredType) {
        if (structuredType.kind !== 'oracle-record') {
          throw new ServerError(
            `Invalid structured type for Oracle bind "${argument.argumentName}"`
          );
        }
        const typeName = this.getRecordTypeName(structuredType);
        let value = this.readPayloadValue(
          payload,
          index,
          argument.argumentName
        );
        if (argument.mode !== 'OUT') {
          value = this.prepareRecordInput(
            value,
            structuredType,
            argument.argumentName
          );
        }
        bindings[argument.argumentName] = {
          dir: OracleProcedureBindings.BINDING_DIRECTIONS[argument.mode],
          type: typeName,
          ...(argument.mode === 'OUT' ? {} : { val: value }),
        };
        if (argument.mode !== 'IN') {
          outBindings.push({
            name: argument.argumentName,
            type: 'object',
            databaseType: typeName,
            structuredType,
          });
        }
        continue;
      }
      if (!this.isValidDataType(dataType)) {
        throw new ServerError(`Invalid data type: ${dataType}`);
      }

      if (argument.mode !== 'IN') {
        outBindings.push({
          name: argument.argumentName,
          type:
            dataType === OracleProcedureBindings.CURSOR_TYPE
              ? 'cursor'
              : OracleProcedureBindings.LOB_TYPES.has(dataType)
                ? 'lob'
                : 'scalar',
          databaseType: dataType,
        });
      }
      if (dataType === OracleProcedureBindings.CURSOR_TYPE) {
        cursorsNames.push(argument.argumentName);
        bindings[argument.argumentName] = {
          dir: OracleProcedureBindings.BINDING_DIRECTIONS[argument.mode],
          type: this.typeMapping[dataType],
        };
        continue;
      }

      let value = this.readPayloadValue(payload, index, argument.argumentName);
      if (
        OracleProcedureBindings.TEMPORAL_TYPES.has(dataType) &&
        argument.mode !== 'OUT'
      ) {
        value = this.prepareTemporalInput(
          value,
          dataType,
          argument.argumentName
        );
      }
      const binding: oracledb.BindParameter = {
        dir: OracleProcedureBindings.BINDING_DIRECTIONS[argument.mode],
        type: this.typeMapping[dataType],
        ...(argument.mode === 'OUT'
          ? {}
          : {
              val: this.rejectArrayValue(value, argument.argumentName),
            }),
        ...(argument.mode !== 'IN' &&
        OracleProcedureBindings.VARIABLE_SIZE_OUT_TYPES.has(dataType)
          ? { maxSize: this.getVariableOutMaxSize(argument.size) }
          : {}),
      };
      bindings[argument.argumentName] = binding;
    }

    return {
      bindings,
      cursorsNames,
      outNames: outBindings.map(({ name }) => name),
      outBindings,
      paramExecuteString: `BEGIN ${SqlIdentifier.formatOracleQualifiedIdentifier(
        [packageName, processName]
      )} (${placeholders.join(',')}); END;`,
    };
  }

  private isValidDataType(
    value: string
  ): value is keyof typeof this.typeMapping {
    return value in this.typeMapping;
  }

  private readPayloadValue(
    payload: TProcedurePayload | null | undefined,
    index: number,
    argumentName: string
  ): unknown {
    if (Array.isArray(payload)) return payload[index] ?? null;
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const normalizedName = argumentName.replace(/^p_/, '');
    return record[normalizedName] ?? record[argumentName] ?? null;
  }

  private rejectArrayValue(value: unknown, argumentName: string): unknown {
    if (!Array.isArray(value)) return value;
    throw new ServerError(
      `Oracle array bind "${argumentName}" is not supported`
    );
  }

  private getRecordTypeName(structuredType: IProcedureStructuredType): string {
    if (!structuredType.owner || !structuredType.packageName) {
      throw new ServerError(
        `Oracle package RECORD "${structuredType.typeName}" has no owner or package metadata`
      );
    }
    return SqlIdentifier.formatOracleQualifiedIdentifier([
      structuredType.owner,
      structuredType.packageName,
      structuredType.typeName,
    ]);
  }

  private prepareRecordInput(
    value: unknown,
    structuredType: IProcedureStructuredType,
    argumentName: string
  ): Record<string, unknown> | null {
    if (value === null || value === undefined) return null;
    if (!this.isPlainObject(value)) {
      throw new ServerError(
        `Oracle RECORD bind "${argumentName}" must be a plain object or null`
      );
    }

    const valuesByName = new Map<
      string,
      { sourceName: string; value: unknown }
    >();
    for (const [sourceName, fieldValue] of Object.entries(value)) {
      const normalizedName = sourceName.toLowerCase();
      if (valuesByName.has(normalizedName)) {
        throw new ServerError(
          `Oracle RECORD bind "${argumentName}" contains conflicting field "${sourceName}"`
        );
      }
      valuesByName.set(normalizedName, { sourceName, value: fieldValue });
    }

    const record: Record<string, unknown> = {};
    for (const field of structuredType.fields) {
      SqlIdentifier.validateIdentifier(field.name, 'oracle record field');
      const normalizedName = field.name.toLowerCase();
      const supplied = valuesByName.get(normalizedName);
      record[field.name] = supplied
        ? this.prepareRecordFieldInput(
            supplied.value,
            field,
            `${argumentName}.${field.name}`
          )
        : null;
      valuesByName.delete(normalizedName);
    }
    if (valuesByName.size > 0) {
      const unknownNames = [...valuesByName.values()]
        .map(({ sourceName }) => sourceName)
        .sort()
        .join(', ');
      throw new ServerError(
        `Oracle RECORD bind "${argumentName}" contains unknown fields: ${unknownNames}`
      );
    }
    return record;
  }

  private prepareRecordFieldInput(
    value: unknown,
    field: IProcedureStructuredField,
    path: string
  ): unknown {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      throw new ServerError(`Oracle array bind "${path}" is not supported`);
    }
    const dataType = field.argumentType.toUpperCase();
    if (OracleProcedureBindings.TEMPORAL_TYPES.has(dataType)) {
      return this.prepareTemporalInput(value, dataType, path);
    }
    if (dataType === 'RAW' && !Buffer.isBuffer(value)) {
      throw new ServerError(
        `Invalid RAW value for Oracle RECORD bind "${path}"`
      );
    }
    if (
      typeof value === 'object' &&
      !(value instanceof Date) &&
      !Buffer.isBuffer(value)
    ) {
      throw new ServerError(
        `Nested Oracle RECORD value "${path}" is not supported`
      );
    }
    return value;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    return prototype === Object.prototype || prototype === null;
  }

  private getVariableOutMaxSize(metadataSize?: number): number {
    const requestedSize =
      metadataSize ?? OracleProcedureBindings.DEFAULT_PLSQL_OUT_MAX_SIZE;
    return Math.min(
      OracleProcedureBindings.DEFAULT_PLSQL_OUT_MAX_SIZE,
      Math.max(OracleProcedureBindings.MINIMUM_OUT_MAX_SIZE, requestedSize)
    );
  }

  private prepareTemporalInput(
    value: unknown,
    dataType: string,
    argumentName: string
  ): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) return value;
    } else if (typeof value === 'string') {
      const parsed = DateFormatter.parseSqlDate(value, {
        requireZone:
          dataType === 'TIMESTAMP WITH TIME ZONE' ||
          dataType === 'TIMESTAMP WITH LOCAL TIME ZONE',
      }).toJSDate();
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    throw new ServerError(
      `Invalid ${dataType} value for Oracle bind "${argumentName}"`
    );
  }
}
