import oracledb from 'oracledb';

import { DateFormatter } from '../../utils/date-formatter.js';
import { isPlainObject } from '../../utils/plain-object.js';
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

/** Internal transport descriptor for RECORD fields returned as scalar binds. */
export class OracleRecordOutBinding implements IProcedureOutBinding {
  public readonly type = 'object';

  public constructor(
    public readonly name: string,
    public readonly databaseType: string,
    public readonly structuredType: IProcedureStructuredType,
    public readonly fieldBindings: ReadonlyMap<string, string>
  ) {}
}

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
  /**
   * Scalar bind types accepted both for procedure arguments and for the fields
   * of an Oracle RECORD. One whitelist serves both: a type that is safe to bind
   * as a RECORD field is equally safe as a standalone argument, and keeping two
   * lists is what let `p_flag IN CHAR` fail with "Invalid data type" while the
   * same CHAR passed as a RECORD field was accepted.
   *
   * Values are node-oracledb bind types, each accepted by the driver as a
   * `BindParameter.type` for IN, OUT and IN/OUT binds. Types with a
   * variable-length bind buffer are listed in `VARIABLE_SIZE_BIND_TYPES` and get
   * an explicit `maxSize` when bound for output; without it the driver falls
   * back to its 200 byte default and truncates longer values.
   *
   * Deliberately left out until each has a result-materializer path and a test:
   * - `NCLOB`, `BFILE`, `LONG`, `LONG RAW` — only `CLOB` and `BLOB` are drained
   *   by the materializer, so these would hand back a raw driver handle.
   * - `ROWID`, `UROWID` — input values must be validated as ROWIDs first.
   * - `JSON`, `VECTOR`, `XMLTYPE` — driver support depends on the database
   *   version, and no serializer covers them on the scalar OUT path.
   * - `INTERVAL YEAR TO MONTH`, `INTERVAL DAY TO SECOND` — the driver binds them
   *   as `IntervalYM`/`IntervalDS` instances and nothing converts input values
   *   into those.
   * - PL/SQL collections (index-by tables, VARRAY, nested tables) and object or
   *   `REF` types — they need `maxArraySize` or DbObject handling; PL/SQL
   *   RECORD arguments are bound through `structuredType` instead.
   */
  private readonly typeMapping = {
    NUMBER: oracledb.NUMBER,
    INTEGER: oracledb.DB_TYPE_NUMBER,
    SMALLINT: oracledb.DB_TYPE_NUMBER,
    DECIMAL: oracledb.DB_TYPE_NUMBER,
    NUMERIC: oracledb.DB_TYPE_NUMBER,
    REAL: oracledb.DB_TYPE_NUMBER,
    FLOAT: oracledb.DB_TYPE_NUMBER,
    'DOUBLE PRECISION': oracledb.DB_TYPE_NUMBER,
    BINARY_FLOAT: oracledb.DB_TYPE_BINARY_FLOAT,
    BINARY_DOUBLE: oracledb.DB_TYPE_BINARY_DOUBLE,
    BINARY_INTEGER: oracledb.DB_TYPE_BINARY_INTEGER,
    PLS_INTEGER: oracledb.DB_TYPE_BINARY_INTEGER,
    'PL/SQL BINARY INTEGER': oracledb.DB_TYPE_BINARY_INTEGER,
    'PL/SQL PLS INTEGER': oracledb.DB_TYPE_BINARY_INTEGER,
    BOOLEAN: oracledb.DB_TYPE_BOOLEAN,
    'PL/SQL BOOLEAN': oracledb.DB_TYPE_BOOLEAN,
    STRING: oracledb.STRING,
    VARCHAR: oracledb.DB_TYPE_VARCHAR,
    VARCHAR2: oracledb.STRING,
    NVARCHAR2: oracledb.DB_TYPE_NVARCHAR,
    CHAR: oracledb.DB_TYPE_CHAR,
    NCHAR: oracledb.DB_TYPE_NCHAR,
    RAW: oracledb.BUFFER,
    BUFFER: oracledb.BUFFER,
    DATE: oracledb.DB_TYPE_DATE,
    TIMESTAMP: oracledb.DB_TYPE_TIMESTAMP,
    'TIMESTAMP WITH TIME ZONE': oracledb.DB_TYPE_TIMESTAMP_TZ,
    'TIMESTAMP WITH LOCAL TIME ZONE': oracledb.DB_TYPE_TIMESTAMP_LTZ,
    CLOB: oracledb.CLOB,
    BLOB: oracledb.BLOB,
    [OracleProcedureBindings.CURSOR_TYPE]: oracledb.CURSOR,
  } as const;
  private static readonly TEMPORAL_TYPES = new Set([
    'DATE',
    'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE',
    'TIMESTAMP WITH LOCAL TIME ZONE',
  ]);
  private static readonly LOB_TYPES = new Set(['CLOB', 'BLOB']);
  /**
   * Bind types whose buffer length is not implied by the type itself. Keyed by
   * driver type rather than by type name so that every alias (`STRING`,
   * `VARCHAR`, `VARCHAR2`, `RAW`, `BUFFER`, …) is covered by construction.
   */
  private static readonly VARIABLE_SIZE_BIND_TYPES = new Set<oracledb.DbType>([
    oracledb.DB_TYPE_CHAR,
    oracledb.DB_TYPE_NCHAR,
    oracledb.DB_TYPE_VARCHAR,
    oracledb.DB_TYPE_NVARCHAR,
    oracledb.DB_TYPE_RAW,
  ]);

  public build(
    packageName: Lowercase<string>,
    processName: Lowercase<string>,
    procedures: TProcedureArgumentList | undefined,
    payload?: TProcedurePayload | null
  ): IBindingsObjectReturn {
    const procedureArguments =
      procedures && Object.hasOwn(procedures, processName)
        ? procedures[processName]
        : undefined;
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
    const recordLogBindings: Record<string, oracledb.BindParameter> = {};
    const cursorsNames: Array<string> = [];
    const outBindings: Array<IProcedureOutBinding> = [];
    const placeholders: Array<string> = [];
    const declarations: Array<string> = [];
    const inputAssignments: Array<string> = [];
    const outputAssignments: Array<string> = [];
    const reservedNames = new Set([
      packageName.toLowerCase(),
      ...procedureArguments.map(({ argumentName }) =>
        argumentName.toLowerCase()
      ),
      ...procedureArguments.flatMap(({ structuredType }) =>
        structuredType
          ? [structuredType.owner ?? '', structuredType.packageName ?? ''].map(
              (name) => name.toLowerCase()
            )
          : []
      ),
    ]);
    let generatedNameIndex = 0;
    const createName = (): string => {
      for (;;) {
        const name = `tpk_record_${generatedNameIndex++}`;
        if (reservedNames.has(name)) continue;
        reservedNames.add(name);
        return name;
      }
    };

    for (const [index, argument] of procedureArguments.entries()) {
      SqlIdentifier.validateIdentifier(argument.argumentName, 'oracle bind');
      const dataType = argument.argumentType.toUpperCase();
      const structuredType = argument.structuredType;
      if (structuredType) {
        if (structuredType.kind !== 'oracle-record') {
          throw new ServerError(
            `Invalid structured type for Oracle bind "${argument.argumentName}"`
          );
        }
        const typeName = this.getRecordTypeName(structuredType);
        const inputValue = this.readPayloadValue(
          payload,
          index,
          argument.argumentName
        );
        const value =
          argument.mode === 'OUT'
            ? null
            : this.prepareRecordInput(
                // A native null INOUT object retains its null indicator after PL/SQL writes fields.
                inputValue ?? (argument.mode === 'IN/OUT' ? {} : null),
                structuredType,
                argument.argumentName
              );
        // OCI 23.26.2 fails to transport RECORDs containing zoned timestamps.
        // Scalar field binds avoid ORA-01891 without retrying the procedure.
        if (
          !oracledb.thin &&
          structuredType.fields.some(
            ({ argumentType }) =>
              argumentType === 'TIMESTAMP WITH TIME ZONE' ||
              argumentType === 'TIMESTAMP WITH LOCAL TIME ZONE'
          )
        ) {
          recordLogBindings[argument.argumentName] = {
            dir: OracleProcedureBindings.BINDING_DIRECTIONS[argument.mode],
            type: typeName,
            ...(argument.mode === 'OUT' ? {} : { val: value }),
          };
          const variable = createName();
          declarations.push(`${variable} ${typeName};`);
          placeholders.push(variable);
          const fieldBindings = new Map<string, string>();
          for (const field of structuredType.fields) {
            const fieldName = `"${SqlIdentifier.validateIdentifier(
              field.name,
              'oracle record field'
            )}"`;
            const fieldType = field.argumentType.toUpperCase();
            if (!this.isValidDataType(fieldType))
              throw new ServerError(
                `Unsupported scalar type ${fieldType} for Oracle RECORD field "${argument.argumentName}.${field.name}"`
              );
            const type = this.typeMapping[fieldType];
            const bindName = createName();
            const isVariableSize =
              OracleProcedureBindings.VARIABLE_SIZE_BIND_TYPES.has(type);
            bindings[bindName] = {
              dir: OracleProcedureBindings.BINDING_DIRECTIONS[argument.mode],
              type,
              ...(argument.mode === 'OUT'
                ? {}
                : { val: value?.[field.name] ?? null }),
              ...(argument.mode !== 'IN' && isVariableSize
                ? {
                    maxSize: OracleProcedureBindings.DEFAULT_PLSQL_OUT_MAX_SIZE,
                  }
                : {}),
            };
            if (argument.mode !== 'OUT')
              inputAssignments.push(
                `${variable}.${fieldName} := :${bindName};`
              );
            if (argument.mode !== 'IN') {
              outputAssignments.push(
                `:${bindName} := ${variable}.${fieldName};`
              );
              fieldBindings.set(field.name, bindName);
            }
          }
          if (argument.mode !== 'IN')
            outBindings.push(
              new OracleRecordOutBinding(
                argument.argumentName,
                typeName,
                structuredType,
                fieldBindings
              )
            );
          continue;
        }
        placeholders.push(`:${argument.argumentName}`);
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
      placeholders.push(`:${argument.argumentName}`);

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
      const type = this.typeMapping[dataType];
      const binding: oracledb.BindParameter = {
        dir: OracleProcedureBindings.BINDING_DIRECTIONS[argument.mode],
        type,
        ...(argument.mode === 'OUT'
          ? {}
          : {
              val: this.rejectArrayValue(value, argument.argumentName),
            }),
        ...(argument.mode !== 'IN' &&
        OracleProcedureBindings.VARIABLE_SIZE_BIND_TYPES.has(type)
          ? { maxSize: this.getVariableOutMaxSize(argument.size) }
          : {}),
      };
      bindings[argument.argumentName] = binding;
    }

    const procedureCall = `${SqlIdentifier.formatOracleQualifiedIdentifier([packageName, processName])} (${placeholders.join(',')});`;
    return {
      bindings,
      ...(declarations.length === 0
        ? {}
        : { logBindings: { ...bindings, ...recordLogBindings } }),
      cursorsNames,
      outNames: outBindings.map(({ name }) => name),
      outBindings,
      paramExecuteString:
        declarations.length === 0
          ? `BEGIN ${procedureCall} END;`
          : `DECLARE ${declarations.join(' ')} BEGIN ${inputAssignments.join(' ')} ${procedureCall} ${outputAssignments.join(' ')} END;`,
    };
  }

  private isValidDataType(
    value: string
  ): value is keyof typeof this.typeMapping {
    return Object.hasOwn(this.typeMapping, value);
  }

  /**
   * Resolves the payload value for one argument.
   *
   * A key counts as supplied when the payload carries it as an own property
   * with a value other than `undefined`: an explicit `null` is a value the
   * caller chose, while `undefined` is the absent optional property of a spread
   * object. Both the declared argument name and its `p_`-stripped alias are
   * accepted, but supplying both is a conflict rather than a silent preference
   * for one of them — the same rule PostgreSQL applies, and the one
   * `prepareRecordInput` already applied to the fields inside a RECORD.
   */
  private readPayloadValue(
    payload: TProcedurePayload | null | undefined,
    index: number,
    argumentName: string
  ): unknown {
    if (Array.isArray(payload)) return payload[index] ?? null;
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const aliasName = argumentName.replace(/^p_/, '');
    const hasAlias =
      aliasName !== argumentName && this.hasPayloadValue(record, aliasName);
    const hasArgumentName = this.hasPayloadValue(record, argumentName);
    if (hasAlias && hasArgumentName) {
      throw new ServerError(
        `Conflicting Oracle procedure payload keys: "${aliasName}" and "${argumentName}"`
      );
    }
    if (hasAlias) return record[aliasName];
    if (hasArgumentName) return record[argumentName];
    return null;
  }

  /** Own-property lookup, so a payload cannot answer with `__proto__` or `toString`. */
  private hasPayloadValue(
    record: Record<string, unknown>,
    key: string
  ): boolean {
    return Object.hasOwn(record, key) && record[key] !== undefined;
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
    if (!isPlainObject(value)) {
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
