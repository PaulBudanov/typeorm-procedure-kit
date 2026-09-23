import { replaceNamedParameters } from '../typeorm/util/NamedParameterUtils.js';

import type {
  IProcedureArgumentBase,
  TProcedureArgumentList,
} from '../types/procedure.types.js';
import type {
  IBindingsObjectReturn,
  IProcedureBindingLogItem,
  ISqlBindingLogItem,
  TQueryLogContext,
} from '../types/utility.types.js';

class QueryLogContextBuilderApi {
  public createProcedureContext(
    packageName: string,
    procedureName: string,
    procedureArguments: TProcedureArgumentList[Lowercase<string>] | undefined,
    bindings: IBindingsObjectReturn['bindings'],
    cursorsNames: Array<string>
  ): TQueryLogContext {
    return {
      kind: 'procedure',
      packageName,
      procedureName,
      bindings:
        procedureArguments?.map((argument) =>
          this.createProcedureBindingLogItem(
            argument,
            this.getProcedureBinding(bindings, argument.argumentName),
            cursorsNames
          )
        ) ?? [],
    };
  }

  public createSqlContext(
    sql: string,
    params?: Record<string, unknown>
  ): TQueryLogContext {
    const paramsByUpperCaseName = Object.fromEntries(
      params
        ? Object.entries(params).map(([key, value]) => [
            key.toUpperCase(),
            value,
          ])
        : []
    );
    const bindings: Array<ISqlBindingLogItem> = [];
    replaceNamedParameters(sql, ({ full, key }) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return full;
      bindings.push({
        name: key,
        value: paramsByUpperCaseName[key.toUpperCase()] ?? null,
      });
      return full;
    });

    return {
      kind: 'sql',
      bindings,
    };
  }

  private createProcedureBindingLogItem(
    argument: Omit<IProcedureArgumentBase, 'procedureName'>,
    binding: unknown,
    cursorsNames: Array<string>
  ): IProcedureBindingLogItem {
    const isCursor =
      cursorsNames.includes(argument.argumentName) ||
      /cursor/i.test(argument.argumentType);
    return {
      name: argument.argumentName,
      type: argument.argumentType,
      mode: argument.mode,
      value: isCursor ? undefined : this.extractBindingLogValue(binding),
      isCursor,
    };
  }

  private extractBindingLogValue(binding: unknown): unknown {
    if (binding !== null && typeof binding === 'object' && 'val' in binding) {
      return (binding as { val?: unknown }).val;
    }
    return binding;
  }

  /**
   * Resolves the logged value strictly by argument name.
   *
   * A positional binding list is deliberately not addressed by the argument's
   * position: an adapter may bind fewer values than the procedure declares
   * arguments (a PostgreSQL composite OUT argument, for example, is inlined as
   * `NULL::type` and consumes no binding), so a positional lookup shifts and
   * prints one argument's value under another argument's name — which also
   * defeats name-based redaction. Adapters that bind positionally publish
   * `logBindings` keyed by argument name for this reason.
   */
  private getProcedureBinding(
    bindings: IBindingsObjectReturn['bindings'],
    argumentName: string
  ): unknown {
    if (Array.isArray(bindings)) return undefined;
    return Object.hasOwn(bindings, argumentName)
      ? bindings[argumentName]
      : undefined;
  }
}

const queryLogContextBuilder = new QueryLogContextBuilderApi();

export { queryLogContextBuilder as QueryLogContextBuilder };
