import { isPlainObject } from '../../utils/plain-object.js';
import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';
import { readPayloadValue } from '../abstract/procedure-payload-reader.js';

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

    const bindings: Array<unknown> = [];
    /**
     * Logical value per argument, keyed by argument name. The positional
     * `bindings` list cannot serve the log: a composite OUT argument is inlined
     * as `NULL::type` and consumes no binding, so from the first one onwards the
     * list is shorter than the argument list and a positional lookup would pair
     * a value with a neighbouring argument's name.
     */
    const logBindings: Record<string, unknown> = {};
    const cursorsNames: Array<string> = [];
    const outBindings: Array<IProcedureOutBinding> = [];
    const argumentExpressions: Array<string> = [];
    for (const [index, argument] of procedureArguments.entries()) {
      // `logValue` is recorded once, after the branches, so no binding branch
      // can be added, reordered or made to skip a positional bind without the
      // log keeping the value under the argument it came from.
      let logValue: unknown;
      const structuredType = argument.structuredType;
      if (structuredType !== undefined) {
        assertSupportedPostgreComposite(argument.argumentType, structuredType);
        if (argument.mode !== 'IN') {
          outBindings.push({
            name: argument.argumentName,
            type: 'object',
            databaseType: argument.argumentType,
            structuredType,
          });
        }
        logValue =
          argument.mode === 'OUT'
            ? undefined
            : readPayloadValue(
                payload,
                index,
                argument.argumentName,
                'PostgreSQL'
              );
        argumentExpressions.push(
          this.createCompositeExpression(
            bindings,
            argument.mode,
            structuredType,
            logValue ?? null,
            argument.argumentName
          )
        );
      } else {
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
          // PostgreSQL ignores/requires NULL for a pure OUT input position. The
          // procedure must assign an explicit portal name before opening it.
          logValue =
            argument.mode === 'OUT'
              ? undefined
              : this.portalNames.normalizeInput(
                  readPayloadValue(
                    payload,
                    index,
                    argument.argumentName,
                    'PostgreSQL'
                  ),
                  argument.argumentName
                );
          bindings.push(logValue ?? null);
        } else {
          logValue = readPayloadValue(
            payload,
            index,
            argument.argumentName,
            'PostgreSQL'
          );
          bindings.push(logValue);
        }
        argumentExpressions.push(`$${bindings.length}`);
      }
      logBindings[argument.argumentName] = logValue;
    }

    return {
      paramExecuteString: `CALL ${SqlIdentifier.quotePostgresQualifiedIdentifier(
        [packageName, processName]
      )}(${argumentExpressions.join(',')})`,
      bindings,
      logBindings,
      cursorsNames,
      outNames: outBindings.map(({ name }) => name),
      outBindings,
    };
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
    if (!isPlainObject(value)) {
      throw new TypeError(
        `PostgreSQL composite argument "${argumentName}" must be a plain object or null`
      );
    }

    const input = value;
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
}
