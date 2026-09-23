import { isPlainObject } from '../../utils/plain-object.js';
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
            : this.readPayloadValue(payload, index, argument.argumentName);
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
                  this.readPayloadValue(payload, index, argument.argumentName),
                  argument.argumentName
                );
          bindings.push(logValue ?? null);
        } else {
          logValue = this.readPayloadValue(
            payload,
            index,
            argument.argumentName
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

  /**
   * Resolves the payload value for one argument.
   *
   * A key counts as supplied when the payload carries it as an own property
   * with a value other than `undefined`: an explicit `null` is a value the
   * caller chose, while `undefined` is the absent optional property of a spread
   * object. Both the declared argument name and its `p_`-stripped alias are
   * accepted, but supplying both is a conflict rather than a silent preference
   * for one of them — the same rule Oracle applies, and the one the composite
   * fields below already applied.
   *
   * Only own properties are read. A key the payload inherits from a prototype
   * of its own, such as a getter of a class DTO, is rejected instead of being
   * bound as `NULL`; see `hasPayloadValue`.
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
      aliasName !== argumentName &&
      this.hasPayloadValue(record, aliasName, argumentName);
    const hasArgumentName = this.hasPayloadValue(
      record,
      argumentName,
      argumentName
    );
    if (hasAlias && hasArgumentName) {
      throw new ServerError(
        `Conflicting PostgreSQL procedure payload keys: "${aliasName}" and "${argumentName}"`
      );
    }
    if (hasAlias) return record[aliasName];
    if (hasArgumentName) return record[argumentName];
    return null;
  }

  /**
   * Whether the payload supplies `key` for `argumentName`: an own property
   * with a value other than `undefined`. A key the payload does not own is
   * never read, so it cannot answer with `__proto__` or `toString`.
   *
   * A key it inherits from a prototype other than `Object.prototype` — a
   * getter, a method or a data property that a class or a prototype object
   * defines — is rejected: binding `NULL` there would drop in silence a value
   * the caller can read on the object. `Object.prototype` members and the
   * `constructor` back-reference that every class prototype carries are not
   * caller data and count as absent.
   *
   * Kept identical to `OracleProcedureBindings.hasPayloadValue`.
   */
  private hasPayloadValue(
    record: Record<string, unknown>,
    key: string,
    argumentName: string
  ): boolean {
    if (Object.hasOwn(record, key)) return record[key] !== undefined;
    if (this.isDefinedOnPayloadPrototype(record, key)) {
      throw new ServerError(
        `Inherited PostgreSQL procedure payload key "${key}" for argument "${argumentName}": only own properties are read, so pass it as an own property, for example by copying it into a plain object`
      );
    }
    return false;
  }

  /**
   * Whether `key` resolves on a prototype of `record` that is not
   * `Object.prototype`, as anything but the `constructor` back-reference of
   * that prototype. The walk stops at the first prototype that owns `key`, the
   * one a property read would answer from, and at `Object.prototype`.
   */
  private isDefinedOnPayloadPrototype(record: object, key: string): boolean {
    for (
      let prototype = Object.getPrototypeOf(record) as object | null;
      prototype !== null && prototype !== Object.prototype;
      prototype = Object.getPrototypeOf(prototype) as object | null
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor === undefined) continue;
      const value: unknown = descriptor.value;
      const isConstructorBackReference =
        key === 'constructor' &&
        typeof value === 'function' &&
        value.prototype === prototype;
      return !isConstructorBackReference;
    }
    return false;
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
