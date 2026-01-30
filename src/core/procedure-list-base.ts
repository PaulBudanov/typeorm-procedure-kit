import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { TDbConfig } from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type {
  IProcedureArgumentBase,
  IProcedureArgumentOracle,
  TDBMapStructure,
} from '../types/procedure.types.js';
import { AsyncUtils } from '../utils/async-utils.js';
import { procedureNameParser } from '../utils/procedure-name-parser.js';
import { StringUtilities } from '../utils/string-utilities.js';

import type { ExecuteBase } from './execute-base.js';

export class ProcedureListBase {
  public packagesWithProceduresList: TDBMapStructure = new Map();

  public constructor(
    private readonly logger: ILoggerModule,
    private readonly databaseAdapter: TAdapterUtilsClassTypes,
    private readonly executeBase: ExecuteBase,
    private readonly packagesSettings?: TDbConfig['packagesSettings']
  ) {}

  /**
   * Fetch procedure list with arguments from database
   * @param packageName - name of package in lowercase
   * @param isRetry - flag to indicate if procedure call failed previously and should be retried
   * @returns Promise<void> - promise that resolves when procedure list is fetched
   */
  public async fetchProcedureListWithArguments(
    packageName: Lowercase<string>,
    isRetry = false
  ): Promise<void> {
    try {
      this.logger.log(
        `Package was changed: ${packageName.toUpperCase()} or init get package info from DB`
      );
      if (this.packagesWithProceduresList.has(packageName))
        this.packagesWithProceduresList.delete(packageName);
      await this.callbackFetchProcedureList(packageName);
      this.checkExistingProcedures(packageName);
      return;
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching procedure list with arguments: ${(error as Error).message}`
      );
      if (isRetry) {
        this.logger.error(
          'Failed to fetch procedure list with arguments. Program will exit.'
        );
        process.exit(1);
      } else {
        this.logger.warn(
          `Retrying fetching procedure list with arguments in 5 minutes`
        );
        await AsyncUtils.delay(1000 * 60 * 5);
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
        `No procedures in map for package ${searchPackageName}, because you don't add they to procedure object`
      );
      return;
    }
    const notFoundProcedures = Object.entries(
      this.packagesSettings!.procedureObjectList
    )
      .map(([_, sqlString]) => {
        const { processName, packageName } = procedureNameParser.parse(
          sqlString,
          this.packagesWithProceduresList,
          this.packagesSettings!.packages
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
        `Procedures not found in package ${searchPackageName.toUpperCase()}: ${notFoundProcedures.join(', ')}`
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
    packageName: Lowercase<string>
  ): Promise<void> {
    const rawArguments = (
      await this.executeBase.execute<
        IProcedureArgumentOracle | IProcedureArgumentBase
      >(this.databaseAdapter.generatePackageInfoSql(packageName))
    ).map((item) => {
      return Object.fromEntries(
        Object.entries(item).map(([key, value]) => {
          return [StringUtilities.toCamelCase(key), value];
        })
      );
    });
    if (rawArguments.length < 1) {
      throw new Error(
        `No arguments in package ${packageName} , load package and restart server or wait get notification for load package`
      );
    }
    if (this.packagesWithProceduresList.has(packageName))
      this.packagesWithProceduresList.delete(packageName);
    // console.log(this.procedureObjectList);
    this.packagesWithProceduresList.set(
      packageName,
      this.databaseAdapter.sortArgumentsAlgorithm(
        rawArguments as
          | Array<IProcedureArgumentOracle>
          | Array<IProcedureArgumentBase>,
        Object.values(this.packagesSettings!.procedureObjectList).map((item) =>
          item.toLowerCase()
        ) as Array<Lowercase<string>>,
        packageName,
        this.packagesSettings!.packages.length
      )
    );
    return;
  }

  /**
   * Initializes the packages map by fetching the procedure list for each package.
   * If no packages are set in the settings, the function does nothing.
   * @returns {Promise<void>} - promise that resolves when the packages map is initialized
   */
  public async initPackagesMap(): Promise<void> {
    if (!this.packagesSettings) return;
    await Promise.all(
      this.packagesSettings?.packages.map((item) => {
        return this.fetchProcedureListWithArguments(
          item.toLowerCase() as Lowercase<string>
        );
      })
    );
    return;
  }
}
