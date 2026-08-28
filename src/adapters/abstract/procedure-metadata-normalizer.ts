import { ServerError } from '../../utils/server-error.js';

import type {
  IProcedureArgumentBase,
  TProcedureArgumentList,
} from '../../types/procedure.types.js';

interface IProcedureMetadataOptions<TOverloadIdentity> {
  vendor: 'Database' | 'Oracle' | 'PostgreSQL';
  noArgumentSentinel?: string;
  includeAllWhenSinglePackage?: boolean;
  getOverloadIdentity?: (
    argument: IProcedureArgumentBase
  ) => TOverloadIdentity | undefined;
}

/** Normalizes metadata once, then sorts each procedure once. */
export class ProcedureMetadataNormalizer {
  public normalize<TOverloadIdentity>(
    rawArguments: Array<IProcedureArgumentBase>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number,
    options: IProcedureMetadataOptions<TOverloadIdentity>
  ): TProcedureArgumentList {
    const configuredNames = new Set<string>(procedureListBase);
    const normalizedPackage = packageName.toLowerCase();
    const procedures: TProcedureArgumentList = {};
    const overloads = new Map<string, TOverloadIdentity>();

    for (const item of rawArguments) {
      const procedureName =
        item.procedureName.toLowerCase() as Lowercase<string>;
      const qualifiedName = `${normalizedPackage}.${procedureName}`;
      const isConfigured =
        configuredNames.has(qualifiedName) ||
        (packagesLength === 1 && configuredNames.has(procedureName));
      if (
        !isConfigured &&
        !(packagesLength === 1 && options.includeAllWhenSinglePackage)
      ) {
        continue;
      }

      const overloadIdentity = options.getOverloadIdentity?.(item);
      if (overloadIdentity !== undefined) {
        const previousIdentity = overloads.get(procedureName);
        if (
          previousIdentity !== undefined &&
          previousIdentity !== overloadIdentity
        ) {
          throw new ServerError(
            `${options.vendor} procedure "${packageName}.${procedureName}" is overloaded; configure an unambiguous procedure signature`
          );
        }
        overloads.set(procedureName, overloadIdentity);
      }

      if (!item.argumentName) {
        continue;
      }
      const argumentName = item.argumentName.toLowerCase();
      const argumentsList = procedures[procedureName] ?? [];
      procedures[procedureName] = argumentsList;
      if (argumentName === options.noArgumentSentinel?.toLowerCase()) continue;

      const argument: Omit<IProcedureArgumentBase, 'procedureName'> = {
        argumentName,
        argumentType: item.argumentType,
        order: item.order,
        mode: item.mode,
        ...(item.size === undefined ? {} : { size: item.size }),
        ...(item.specificName === undefined
          ? {}
          : { specificName: item.specificName }),
        ...(item.owner === undefined ? {} : { owner: item.owner }),
        ...(item.subprogramId === undefined
          ? {}
          : { subprogramId: item.subprogramId }),
        ...(item.overload === undefined ? {} : { overload: item.overload }),
      };
      argumentsList.push(argument);
    }

    for (const argumentsList of Object.values(procedures)) {
      argumentsList.sort((left, right) => left.order - right.order);
    }
    return procedures;
  }
}
