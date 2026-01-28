import type {
  IProcedureArgumentOracle,
  IProcedureArgumentPostgre,
  TDBMapStructure,
} from '../types.js';
import { delay } from '../utils/delay.js';
import { getProcedureNameAndPackage } from '../utils/getProcedureAndPackageName.js';

import { ExecuteBase } from './execute-base.js';

export class ProcedureListBase extends ExecuteBase {
  protected packagesWithProceduresList: TDBMapStructure = new Map();

  /**
   * Fetch procedure list with arguments from database
   * @param packageName - name of package in lowercase
   * @param isRetry - flag to indicate if procedure call failed previously and should be retried
   * @returns Promise<void> - promise that resolves when procedure list is fetched
   */
  protected async fetchProcedureListWithArguments(
    packageName: Lowercase<string>,
    isRetry = false,
  ): Promise<void> {
    try {
      this.logger.log(
        `Package was changed: ${packageName.toUpperCase()} or init get package info from DB`,
      );
      if (this.packagesWithProceduresList.has(packageName))
        this.packagesWithProceduresList.delete(packageName);
      await this.callbackFetchProcedureList(packageName);
      this.checkExistingProcedures(packageName);
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching procedure list with arguments: ${(error as Error).message}`,
      );
      if (isRetry) {
        this.logger.error(
          'Failed to fetch procedure list with arguments. Program will exit.',
        );
        process.exit(1);
      } else {
        this.logger.warn(
          `Retrying fetching procedure list with arguments in 5 minutes`,
        );
        await delay(1000 * 60 * 5);
        await this.fetchProcedureListWithArguments(packageName, true);
      }
    }
  }

  /**
   * Checks if all procedures in procedureObjectList are present in the map of procedures for the given package name.
   * If any procedures are not found, logs an error with the names of the missing procedures.
   * @param searchPackageName - name of package to search for procedures in
   */
  private checkExistingProcedures(searchPackageName: Lowercase<string>): void {
    const procedureObject =
      this.packagesWithProceduresList.get(searchPackageName);
    if (!procedureObject || Object.keys(procedureObject).length < 1) {
      this.logger.error(`No procedure list for package ${searchPackageName}`);
      return;
    }
    const procedureMap = Object.entries(procedureObject) as Array<
      [Lowercase<string>, object]
    >;
    if (procedureMap.length < 1) {
      this.logger.warn(
        `No procedures in map for package ${searchPackageName}, because you don't add they to procedure object`,
      );
      return;
    }
    const notFoundProcedures = Object.entries(this.procedureObjectList)
      .map(([_, sqlString]) => {
        const { processName, packageName } = getProcedureNameAndPackage(
          sqlString,
          this.packagesWithProceduresList,
          this.dbConfig.dbPackages,
        );
        if (packageName !== searchPackageName) return null;
        if (
          !procedureMap.some((item) => {
            return item[0] === processName && packageName === searchPackageName;
          })
        )
          return processName;
        return null;
      })
      .filter((item) => item !== null);
    if (notFoundProcedures.length > 0) {
      this.logger.error(
        `Procedures not found in package ${searchPackageName.toUpperCase()}: ${notFoundProcedures.join(', ')}`,
      );
    }
  }

  /**
   * Fetches the list of procedures for a given package name and stores it in the packagesWithProceduresList map.
   * If the package already exists in the map, it is overwritten.
   * If the package does not exist in the map, it checks if the package has any procedures in the procedureObjectList.
   * If the package does not have any procedures in the procedureObjectList, it throws an error.
   * If the package has procedures in the procedureObjectList, it sorts the procedures by their position and stores them in the packagesWithProceduresList map.
   * @param packageName - name of package to fetch procedures for
   * @throws Error - if the package does not have any procedures in the procedureObjectList
   */
  private async callbackFetchProcedureList(
    packageName: Lowercase<string>,
  ): Promise<void> {
    const rawArguments = await this.execute<
      IProcedureArgumentOracle | IProcedureArgumentPostgre
    >(this.dbUtilsInstance.generatePackageInfoSql(packageName));
    if (rawArguments.length < 1) {
      throw new Error(
        `No arguments in package ${packageName} , load package and restart server or wait get notification for load package`,
      );
    }
    if (this.packagesWithProceduresList.has(packageName))
      this.packagesWithProceduresList.delete(packageName);
    // console.log(this.procedureObjectList);
    this.packagesWithProceduresList.set(
      packageName,
      this.dbUtilsInstance.sortArgumentsAlgorithm(
        rawArguments as
          | Array<IProcedureArgumentOracle>
          | Array<IProcedureArgumentPostgre>,
        Object.values(this.procedureObjectList).map((item) =>
          item.toLowerCase(),
        ) as Array<Lowercase<string>>,
        packageName,
        this.dbConfig.dbPackages.length,
      ),
    );
    return;
  }
  /**
   * Initializes the packagesWithProceduresList map by fetching the list of procedures for each package in the dbConfig.dbPackages array.
   * @returns Promise that resolves when all packages have been processed
   */
  protected async initPackagesMap(): Promise<Array<void>> {
    return await Promise.all(
      this.dbConfig.dbPackages.map((item) => {
        return this.fetchProcedureListWithArguments(
          item.toLowerCase() as Lowercase<string>,
        );
      }),
    );
  }
}
