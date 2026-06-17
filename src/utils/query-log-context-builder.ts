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

export class QueryLogContextBuilder {
  public static createProcedureContext(
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
        procedureArguments?.map((argument, index) =>
          this.createProcedureBindingLogItem(
            argument,
            this.getProcedureBinding(bindings, argument.argumentName, index),
            cursorsNames
          )
        ) ?? [],
    };
  }

  public static createSqlContext(
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

  private static createProcedureBindingLogItem(
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

  private static extractBindingLogValue(binding: unknown): unknown {
    if (binding && typeof binding === 'object' && 'val' in binding) {
      return (binding as { val?: unknown }).val;
    }
    return binding;
  }

  private static getProcedureBinding(
    bindings: IBindingsObjectReturn['bindings'],
    argumentName: string,
    index: number
  ): unknown {
    if (Array.isArray(bindings)) return bindings[index];
    return bindings[argumentName];
  }
}
