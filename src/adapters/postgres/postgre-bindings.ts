import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';

import {
  assertSupportedPostgreComposite,
  quotePostgreCompositeType,
} from './postgre-composite.js';

import type { PostgrePortalName } from './postgre-portal-name.js';
import type {
  IProcedureStructuredField,
  IProcedureStructuredType,
  TProcedureArgumentList,
  TProcedurePayload,
} from '../../types/procedure.types.js';
import type { IColumnNameTransformStrategy } from '../../types/strategy.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
} from '../../types/utility.types.js';

/** Builds PostgreSQL CALL bindings without owning execution or result fetching. */
export class PostgreProcedureBindings {
  private static readonly REF_CURSOR_TYPE = 'refcursor';

  public constructor(
    private readonly portalNames: PostgrePortalName,
    private readonly caseStrategy: IColumnNameTransformStrategy
  ) {}

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

    const bindings: Array<unknown> = [];
    const cursorsNames: Array<string> = [];
    const outBindings: Array<IProcedureOutBinding> = [];
    const argumentExpressions: Array<string> = [];
    for (const [index, argument] of procedureArguments.entries()) {
      if (argument.structuredType !== undefined) {
        const structuredType = argument.structuredType;
        assertSupportedPostgreComposite(argument.argumentType, structuredType);
        if (argument.mode !== 'IN') {
          outBindings.push({
            name: argument.argumentName,
            type: 'object',
            databaseType: argument.argumentType,
            structuredType,
          });
        }
        argumentExpressions.push(
          this.createCompositeExpression(
            bindings,
            argument.mode,
            structuredType,
            argument.mode === 'OUT'
              ? null
              : this.readPayloadValue(
                  payload,
                  index,
                  argument.argumentName,
                  true
                ),
            argument.argumentName
          )
        );
        continue;
      }

      const isCursor =
        argument.argumentType.toLowerCase() ===
        PostgreProcedureBindings.REF_CURSOR_TYPE;
      if (argument.mode !== 'IN') {
        outBindings.push({
          name: argument.argumentName,
          type: isCursor ? 'cursor' : 'scalar',
          databaseType: argument.argumentType,
        });
      }
      if (isCursor) {
        if (argument.mode !== 'IN') cursorsNames.push(argument.argumentName);
        bindings.push(
          // PostgreSQL ignores/requires NULL for a pure OUT input position. The
          // procedure must assign an explicit portal name before opening it.
          argument.mode === 'OUT'
            ? null
            : this.portalNames.normalizeInput(
                this.readPayloadValue(payload, index, argument.argumentName),
                argument.argumentName
              )
        );
        argumentExpressions.push(`$${bindings.length}`);
        continue;
      }

      const value = this.readPayloadValue(
        payload,
        index,
        argument.argumentName
      );
      bindings.push(value);
      argumentExpressions.push(`$${bindings.length}`);
    }

    return {
      paramExecuteString: `CALL ${SqlIdentifier.quotePostgresQualifiedIdentifier(
        [packageName, processName]
      )}(${argumentExpressions.join(',')})`,
      bindings,
      cursorsNames,
      outNames: outBindings.map(({ name }) => name),
      outBindings,
    };
  }

  private readPayloadValue(
    payload: TProcedurePayload | null | undefined,
    index: number,
    argumentName: string,
    shouldRejectAliasConflict = false
  ): unknown {
    if (Array.isArray(payload)) return payload[index] ?? null;
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    const normalizedName = argumentName.replace(/^p_/, '');
    const hasNormalizedName = Object.hasOwn(record, normalizedName);
    const hasArgumentName = Object.hasOwn(record, argumentName);
    if (shouldRejectAliasConflict) {
      if (
        normalizedName !== argumentName &&
        hasNormalizedName &&
        hasArgumentName
      ) {
        throw new ServerError(
          `Conflicting PostgreSQL procedure payload keys: "${normalizedName}" and "${argumentName}"`
        );
      }
      if (hasNormalizedName) return record[normalizedName];
      if (hasArgumentName) return record[argumentName];
      return null;
    }
    return record[normalizedName] ?? record[argumentName] ?? null;
  }

  private createCompositeExpression(
    bindings: Array<unknown>,
    mode: 'IN' | 'OUT' | 'IN/OUT',
    structuredType: IProcedureStructuredType,
    value: unknown,
    argumentName: string
  ): string {
    const qualifiedType = quotePostgreCompositeType(structuredType);
    if (mode === 'OUT') return `NULL::${qualifiedType}`;
    const normalizedValue = this.normalizeCompositeInput(
      value,
      structuredType,
      argumentName
    );
    bindings.push(normalizedValue);
    const placeholder = `$${bindings.length}::jsonb`;
    return `CASE WHEN ${placeholder} IS NULL OR ${placeholder} = 'null'::jsonb THEN NULL::${qualifiedType} ELSE jsonb_populate_record(NULL::${qualifiedType}, ${placeholder}) END`;
  }

  private normalizeCompositeInput(
    value: unknown,
    structuredType: IProcedureStructuredType,
    argumentName: string
  ): string | null {
    if (value === null || value === undefined) return null;
    if (!this.isPlainObject(value)) {
      throw new TypeError(
        `PostgreSQL composite argument "${argumentName}" must be a plain object or null`
      );
    }

    const input = value as Record<string, unknown>;
    const acceptedKeys = this.indexCompositeInputKeys(structuredType);
    for (const key of Object.keys(input)) {
      if (!acceptedKeys.has(key)) {
        throw new ServerError(
          `Unknown field "${key}" for PostgreSQL composite argument "${argumentName}"`
        );
      }
    }

    const normalized: Record<string, unknown> = {};
    for (const field of structuredType.fields) {
      const transformedName = this.caseStrategy.transformColumnName(field.name);
      const hasRawName = Object.hasOwn(input, field.name);
      const hasTransformedName = Object.hasOwn(input, transformedName);
      if (transformedName !== field.name && hasRawName && hasTransformedName) {
        throw new ServerError(
          `Conflicting fields "${field.name}" and "${transformedName}" for PostgreSQL composite argument "${argumentName}"`
        );
      }
      let fieldValue: unknown = null;
      if (hasRawName) fieldValue = input[field.name];
      else if (hasTransformedName) fieldValue = input[transformedName];
      normalized[field.name] = this.normalizeCompositeFieldValue(
        field,
        fieldValue
      );
    }

    try {
      return JSON.stringify(normalized, (_key, nestedValue: unknown) =>
        typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue
      );
    } catch (error: unknown) {
      throw new ServerError(
        `PostgreSQL composite argument "${argumentName}" cannot be converted to JSON`,
        error,
        { cause: error }
      );
    }
  }

  private indexCompositeInputKeys(
    structuredType: IProcedureStructuredType
  ): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const field of structuredType.fields) {
      const transformedName = this.caseStrategy.transformColumnName(field.name);
      for (const key of new Set([field.name, transformedName])) {
        if (keys.has(key)) {
          throw new ServerError(
            `PostgreSQL composite metadata contains conflicting field key "${key}"`
          );
        }
        keys.add(key);
      }
    }
    return keys;
  }

  private normalizeCompositeFieldValue(
    field: IProcedureStructuredField,
    value: unknown
  ): unknown {
    if (value === undefined) return null;
    if (
      Buffer.isBuffer(value) &&
      field.argumentType.trim().toLowerCase() === 'bytea'
    ) {
      return `\\x${value.toString('hex')}`;
    }
    return value;
  }

  private isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
  }
}
