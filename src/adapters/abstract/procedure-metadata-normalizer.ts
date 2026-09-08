import { ServerError } from '../../utils/server-error.js';

import type { IProcedureMetadataOptions } from '../../interfaces/procedure-metadata-normalizer.interfaces.js';
import type {
  IProcedureArgumentBase,
  TProcedureArgumentList,
} from '../../types/procedure.types.js';

/** Normalizes metadata once, then sorts each procedure once. */
export class ProcedureMetadataNormalizer {
  public normalize(
    rawArguments: Array<IProcedureArgumentBase>,
    procedureListBase: Array<Lowercase<string>>,
    packageName: Lowercase<string>,
    packagesLength: number,
    options: IProcedureMetadataOptions
  ): TProcedureArgumentList {
    const configuredNames = new Set<string>(procedureListBase);
    const normalizedPackage = packageName.toLowerCase();
    const procedures: TProcedureArgumentList = {};
    const overloads = new Map<string, unknown>();

    for (const item of rawArguments) {
      const procedureName =
        item.procedureName.toLowerCase() as Lowercase<string>;
      const qualifiedName = `${normalizedPackage}.${procedureName}`;
      const isConfigured =
        configuredNames.has(qualifiedName) ||
        (packagesLength === 1 && configuredNames.has(procedureName));
      if (!isConfigured) continue;

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
        ...(item.structuredType === undefined
          ? {}
          : { structuredType: item.structuredType }),
      };
      argumentsList.push(argument);
    }

    for (const argumentsList of Object.values(procedures)) {
      argumentsList.sort((left, right) => left.order - right.order);
    }
    return procedures;
  }
}
