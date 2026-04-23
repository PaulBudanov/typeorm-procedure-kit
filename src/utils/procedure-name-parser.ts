import type { TDBMapStructure } from '../types/procedure.types.js';

import { DatabaseNamingCache } from './database-naming-cache.js';
import { ServerError } from './server-error.js';

interface IProcedureNameParser extends Record<string, unknown> {
  processName: Lowercase<string>;
  packageName: Lowercase<string>;
}

class ProcedureNameParser {
  private databaseNamingCache = new DatabaseNamingCache<IProcedureNameParser>();
  private cacheKey = Symbol('procedureNameParser');

  public constructor() {
    this.databaseNamingCache.createCache(this.cacheKey);
  }

  /**
   * Destroys the cache used by the ProcedureNameParser.
   *This method should be called when the ProcedureNameParser is no longer needed.
   */
  public destroy(): void {
    this.databaseNamingCache.cacheClear(this.cacheKey);
  }
  /**
   * Parse the given executeString into a procedure name and package name.
   * The executeString can be in the format of either 'packageName.procedureName' or just 'procedureName'.
   * If the executeString is in the format of 'packageName.procedureName', it will be parsed into a procedure name and package name.
   * If the executeString is just 'procedureName', it will be parsed into a procedure name and package name only if there is one package in the packages array.
   * If the executeString cannot be parsed into a procedure name and package name, it will throw a ServerError.
   * @param executeString - the string to be parsed
   * @param procedureList - the map of available procedures
   * @param packages - the array of available packages
   * @returns an object with the procedure name and package name
   * @throws ServerError - if the executeString cannot be parsed into a procedure name and package name
   */
  public parse(
    executeString: string,
    procedureList: TDBMapStructure,
    packages: Array<Lowercase<string>>
  ): IProcedureNameParser {
    const cached = this.databaseNamingCache.cacheGet(
      this.cacheKey,
      executeString
    );
    if (cached) return cached;

    const normalized = executeString.trim().toLowerCase();
    const parts = normalized.split('.') as Array<Lowercase<string>>;
    let result: IProcedureNameParser | null = null;

    // Формат: packageName.procedureName
    if (parts.length === 2) {
      const [packageName, processName] = parts;
      if (packageName && processName && procedureList.has(packageName)) {
        result = { packageName, processName };
      }
    }
    // Формат: procedureName (только если один пакет)
    else if (parts.length === 1 && packages.length === 1) {
      const [packageName] = packages;
      const [processName] = parts;
      if (packageName && processName && procedureList.has(packageName)) {
        result = { packageName, processName };
      }
    }

    if (!result) {
      throw new ServerError(
        `Procedure or package with name '${executeString}' not found. ` +
          `Use format 'PackageName.ProcedureName' or just 'ProcedureName' ` +
          `if only one package exists. Available packages: ${packages.join(', ')}.`
      );
    }

    this.databaseNamingCache.cacheSet(this.cacheKey, executeString, result);
    return result;
  }

  /**
   * Checks if the given executeString is in a valid format.
   * The valid formats are either 'procedureName' or 'packageName.procedureName'.
   * @param executeString - the string to be validated
   * @returns true if the format is valid, false otherwise
   */
  public validateFormat(executeString: string): boolean {
    const normalized = executeString.trim().toLowerCase();
    const parts = normalized.split('.');
    return parts.length === 1 || parts.length === 2;
  }

  /**
   * Extracts the package name from the given executeString.
   * If the executeString is in the format of 'packageName.procedureName', it will return the package name.
   * If the executeString is just 'procedureName', it will return undefined.
   * @param executeString - the string to extract the package name from
   * @returns the package name if the executeString is in the format of 'packageName.procedureName', undefined otherwise
   */
  public extractPackageName(executeString: string): string | undefined {
    const normalized = executeString.trim().toLowerCase();
    const parts = normalized.split('.');

    if (parts.length === 2) {
      return parts[0];
    }

    return undefined;
  }

  /**
   * Extracts the procedure name from the given executeString.
   * If the executeString is in the format of 'packageName.procedureName', it will return the procedure name.
   * If the executeString is just 'procedureName', it will return the procedure name.
   * @param executeString - the string to extract the procedure name from
   * @returns the procedure name
   */
  public extractProcedureName(executeString: string): string {
    const normalized = executeString.trim().toLowerCase();
    const parts = normalized.split('.');

    return parts.length === 2 ? (parts[1] as string) : (parts[0] as string);
  }

  /**
   * Trims and converts the given executeString to lowercase.
   * @param executeString - the string to normalize
   * @returns the normalized string
   */
  public normalize(executeString: string): string {
    return executeString.trim().toLowerCase();
  }

  /**
   * Formats a display name for a procedure by combining the package name and procedure name.
   * The format is 'packageName.procedureName'.
   * @param packageName - the name of the package
   * @param procedureName - the name of the procedure
   * @returns the formatted display name
   */
  public formatDisplayName(packageName: string, procedureName: string): string {
    return `${packageName}.${procedureName}`;
  }
}
export const procedureNameParser = new ProcedureNameParser();
