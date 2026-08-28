import oracledb from 'oracledb';

import { DateFormatter } from '../../utils/date-formatter.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';

import type {
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
  private readonly bindingDirections = {
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
  private readonly temporalTypes = new Set([
    'DATE',
    'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE',
    'TIMESTAMP WITH LOCAL TIME ZONE',
  ]);
  private readonly variableSizeOutTypes = new Set([
    'STRING',
    'VARCHAR2',
    'RAW',
  ]);
  private readonly lobTypes = new Set(['CLOB', 'BLOB']);

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
      if (!this.isValidDataType(dataType)) {
        throw new ServerError(`Invalid data type: ${dataType}`);
      }

      if (argument.mode !== 'IN') {
        outBindings.push({
          name: argument.argumentName,
          type:
            dataType === OracleProcedureBindings.CURSOR_TYPE
              ? 'cursor'
              : this.lobTypes.has(dataType)
                ? 'lob'
                : 'scalar',
          databaseType: dataType,
        });
      }
      if (dataType === OracleProcedureBindings.CURSOR_TYPE) {
        cursorsNames.push(argument.argumentName);
        bindings[argument.argumentName] = {
          dir: this.bindingDirections[argument.mode],
          type: this.typeMapping[dataType],
        };
        continue;
      }

      let value = this.readPayloadValue(payload, index, argument.argumentName);
      if (this.temporalTypes.has(dataType) && argument.mode !== 'OUT') {
        value = this.prepareTemporalInput(
          value,
          dataType,
          argument.argumentName
        );
      }
      const binding: oracledb.BindParameter = {
        dir: this.bindingDirections[argument.mode],
        type: this.typeMapping[dataType],
        ...(argument.mode === 'OUT' ? {} : { val: this.normalizeArray(value) }),
        ...(argument.mode !== 'IN' && this.variableSizeOutTypes.has(dataType)
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

  private normalizeArray(value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    return value.length > 1 ? value.join(',') : value.toString();
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
