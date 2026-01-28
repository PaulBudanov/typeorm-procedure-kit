import type { TDBMapStructure } from '../types.js';

/**
 * Returns an object with the following properties:
 * - processName: name of the procedure or SQL query in lowercase
 * - packageName: name of the package (schema) in lowercase
 *
 * @param executeString - name of procedure in format PackageName(schema).ProcedureName or only ProcedureName if only one package(schema)
 * @param procedureList - list of procedures with their arguments
 * @param packages - array of package names in lowercase
 *
 * @throws Error - if procedure or package not found
 *
 * @returns an object with processName and packageName
 */
//TODO: Migrate to class
export function getProcedureNameAndPackage(
  executeString: string,
  procedureList: TDBMapStructure,
  packages: Array<Lowercase<string>>,
): {
  processName: Lowercase<string>;
  packageName: Lowercase<string>;
} {
  const normalizedExecuteString = executeString.trim().toLowerCase();
  let foundPackageName: string | undefined;
  let foundProcessName: string | undefined;
  const parts = normalizedExecuteString.split('.') as Array<Lowercase<string>>;
  //packageName.procedureName format
  if (parts.length === 2) {
    const [packageName, processName] = parts;
    if (procedureList.has(packageName)) {
      foundPackageName = packageName;
      foundProcessName = processName;
    }
  }
  //procedureName format (only works with single package)
  if (parts.length === 1 && packages.length === 1) {
    if (procedureList.has(packages[0])) {
      foundPackageName = packages[0];
      foundProcessName = parts[0];
    }
  }
  if (!foundPackageName || !foundProcessName) {
    throw new Error(
      `Procedure or package not found: '${executeString}'. ` +
        `Expected format: 'packageName.procedureName' or just 'procedureName' if it exists in one package. ` +
        `Available packages: ${packages.join(', ')}, packages total length: ${packages.length}.`,
    );
  }

  return {
    processName: foundProcessName.toLowerCase() as Lowercase<string>,
    packageName: foundPackageName.toLowerCase() as Lowercase<string>,
  };
}
