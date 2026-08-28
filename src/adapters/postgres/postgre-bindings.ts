import { ServerError } from '../../utils/server-error.js';
import { SqlIdentifier } from '../../utils/sql-identifier.js';

import type { PostgrePortalName } from './postgre-portal-name.js';
import type {
  TProcedureArgumentList,
  TProcedurePayload,
} from '../../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureOutBinding,
} from '../../types/utility.types.js';

/** Builds PostgreSQL CALL bindings without owning execution or result fetching. */
export class PostgreProcedureBindings {
  private static readonly REF_CURSOR_TYPE = 'refcursor';

  public constructor(private readonly portalNames: PostgrePortalName) {}

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
    for (const [index, argument] of procedureArguments.entries()) {
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
        continue;
      }

      const value = this.readPayloadValue(
        payload,
        index,
        argument.argumentName
      );
      bindings.push(
        Array.isArray(value)
          ? value.length > 1
            ? value.join(',')
            : value.toString()
          : value
      );
    }

    return {
      paramExecuteString: `CALL ${SqlIdentifier.quotePostgresQualifiedIdentifier(
        [packageName, processName]
      )}(${bindings.map((_, index) => `$${index + 1}`).join(',')})`,
      bindings,
      cursorsNames,
      outNames: outBindings.map(({ name }) => name),
      outBindings,
    };
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
}
