import { ProcedureNameParser } from '../utils/procedure-name-parser.js';
import { DEFAULT_RESOURCE_LIMITS } from '../utils/resource-limits.js';
import { ServerError } from '../utils/server-error.js';
import { StringUtilities } from '../utils/string-utilities.js';

import type { ExecuteBase } from './execute-base.js';
import type { TAdapterUtilsClassTypes } from '../types/adapter.types.js';
import type { TDbConfig } from '../types/config.types.js';
import type { ILoggerModule } from '../types/logger.types.js';
import type {
  IProcedureArgumentBase,
  TProcedureArgumentMode,
  TDBMapStructure,
  TProcedureArgumentList,
} from '../types/procedure.types.js';

interface IPackageFetchState {
  promise: Promise<void>;
  rerunRequested: boolean;
}

export class ProcedureListBase {
  public packagesWithProceduresList: TDBMapStructure = new Map();
  private readonly procedureNameParser = new ProcedureNameParser();
  private readonly retryTimers = new Map<
    Lowercase<string>,
    ReturnType<typeof setTimeout>
  >();
  private readonly activeFetchPromises = new Set<Promise<void>>();
  private readonly packageFetchStates = new Map<
    Lowercase<string>,
    IPackageFetchState
  >();
  private destroyPromise: Promise<void> | null = null;
  private isDestroyed = false;
  private static readonly RETRY_DELAY_MS = 1000 * 60 * 5;

  public constructor(
    private readonly logger: ILoggerModule,
    private readonly databaseAdapter: TAdapterUtilsClassTypes,
    private readonly executeBase: ExecuteBase,
    private readonly packagesSettings?: TDbConfig['packagesSettings'],
    private readonly maxMetadataRows = DEFAULT_RESOURCE_LIMITS.maxMetadataRows
  ) {}

  /**
   * Fetch procedure list with arguments from database
   * @param packageName - name of package in lowercase
   * @returns Promise<void> - promise that resolves when procedure list is fetched
   */
  public fetchProcedureListWithArguments(
    packageName: Lowercase<string>
  ): Promise<void> {
    if (this.isDestroyed) {
      return Promise.reject(new ServerError('ProcedureListBase is destroyed'));
    }

    const activeState = this.packageFetchStates.get(packageName);
    if (activeState) {
      activeState.rerunRequested = true;
      return activeState.promise;
    }

    const state = {
      promise: Promise.resolve(),
      rerunRequested: false,
    };
    const fetchPromise = (async (): Promise<void> => {
      let lastError: unknown;
      do {
        state.rerunRequested = false;
        try {
          await this.fetchProcedureListInternal(packageName);
          lastError = undefined;
        } catch (error: unknown) {
          lastError = error;
        }
      } while (this.shouldRerunFetch(state));
      if (lastError !== undefined) {
        throw lastError instanceof Error
          ? lastError
          : ServerError.ENSURE_SERVER_ERROR({ error: lastError });
      }
    })();
    state.promise = fetchPromise;
    this.packageFetchStates.set(packageName, state);
    this.activeFetchPromises.add(fetchPromise);
    const clearFetch = (): void => {
      this.activeFetchPromises.delete(fetchPromise);
      if (this.packageFetchStates.get(packageName) === state) {
        this.packageFetchStates.delete(packageName);
      }
    };
    void fetchPromise.then(clearFetch, clearFetch);
    return fetchPromise;
  }

  /** Re-reads fetch state that callers may mutate while the request is awaited. */
  private shouldRerunFetch(state: IPackageFetchState): boolean {
    return state.rerunRequested && !this.isDestroyed;
  }

  private async fetchProcedureListInternal(
    packageName: Lowercase<string>
  ): Promise<void> {
    try {
      this.logger.log(
        `Package was changed: ${packageName.toUpperCase()} or init get package info from DB`
      );

      const packageSnapshot = await this.fetchPackageSnapshot(packageName);
      this.assertActive();
      this.checkExistingProcedures(packageName, packageSnapshot);
      this.assertActive();

      const nextSnapshot = new Map(this.packagesWithProceduresList);
      nextSnapshot.set(packageName, packageSnapshot);
      this.packagesWithProceduresList = nextSnapshot;
      this.procedureNameParser.clear();
      this.clearRetryTimer(packageName);
    } catch (error: unknown) {
      const metadataError = ServerError.ENSURE_SERVER_ERROR({ error });
      const errorMessage = metadataError.message;
      this.logger.error(
        `Error fetching procedure list with arguments: ${errorMessage}`
      );

      if (!this.isDestroyed) this.scheduleRetry(packageName);
      throw new ServerError(
        `Failed to fetch procedure list with arguments for package ${packageName}: ${errorMessage}`,
        error,
        { cause: error }
      );
    }
  }

  private assertActive(): void {
    if (this.isDestroyed)
      throw new ServerError('ProcedureListBase is destroyed');
  }

  /** Parses a procedure name using the cache owned by this metadata registry. */
  public parseProcedureName(
    executeString: string,
    packages: Array<Lowercase<string>>
  ): { processName: Lowercase<string>; packageName: Lowercase<string> } {
    return this.procedureNameParser.parse(
      executeString,
      this.packagesWithProceduresList,
      packages
    );
  }

  private scheduleRetry(packageName: Lowercase<string>): void {
    if (this.isDestroyed || this.retryTimers.has(packageName)) return;

    this.logger.warn(
      `Retrying fetching procedure list with arguments for ${packageName.toUpperCase()} in 5 minutes`
    );
    const timer = setTimeout(() => {
      this.retryTimers.delete(packageName);
      if (this.isDestroyed) return;
      void this.fetchProcedureListWithArguments(packageName).catch(
        (error: unknown) => {
          const metadataError = ServerError.ENSURE_SERVER_ERROR({ error });
          this.logger.error(
            `Background procedure metadata refresh failed for ${packageName}: ${metadataError.message}`
          );
        }
      );
    }, ProcedureListBase.RETRY_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
    this.retryTimers.set(packageName, timer);
  }

  private clearRetryTimer(packageName: Lowercase<string>): void {
    const timer = this.retryTimers.get(packageName);
    if (!timer) return;
    clearTimeout(timer);
    this.retryTimers.delete(packageName);
  }

  /**
   * Checks if all procedures in procedureObjectList are present in the map of procedures for the given package name.
   * If any procedures are not found, logs an error with the names of the missing procedures.
   * @param searchPackageName - name of package to search for procedures in
   */
  private checkExistingProcedures(
    searchPackageName: Lowercase<string>,
    procedureObject: TProcedureArgumentList
  ): void {
    if (Object.keys(procedureObject).length < 1) {
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

    if (!this.packagesSettings) return;
    const { packages, procedureObjectList } = this.packagesSettings;

    const notFoundProcedures = Object.entries(procedureObjectList)
      .map(([_, sqlString]) => {
        const explicitPackageName =
          this.procedureNameParser.extractPackageName(sqlString);
        const packageName = (explicitPackageName ??
          (packages.length === 1 ? packages[0] : undefined)) as
          | Lowercase<string>
          | undefined;

        if (packageName !== searchPackageName) return null;

        const processName = this.procedureNameParser.extractProcedureName(
          sqlString
        ) as Lowercase<string>;

        return procedureMap.some((item) => item[0] === processName)
          ? null
          : processName;
      })
      .filter((item): item is Lowercase<string> => item !== null);

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

  private async fetchPackageSnapshot(
    packageName: Lowercase<string>
  ): Promise<TProcedureArgumentList> {
    if (!this.packagesSettings) {
      throw new ServerError('Package settings are not configured');
    }

    const metadataRows = await this.executeBase.execute<unknown>(
      this.databaseAdapter.generatePackageInfoSql(
        packageName,
        this.packagesSettings.procedureMetadataSql
      )
    );
    if (metadataRows.length > this.maxMetadataRows) {
      throw new ServerError(
        `Procedure metadata exceeds resourceLimits.maxMetadataRows (${this.maxMetadataRows})`
      );
    }
    const rawArguments = metadataRows.map((item, index) => {
      const normalizedItem =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).map(([key, itemValue]) => [
                StringUtilities.toCamelCase(key),
                itemValue,
              ])
            )
          : item;
      return this.decodeProcedureArgument(normalizedItem, index);
    });

    if (rawArguments.length < 1) {
      throw new ServerError(
        `No arguments in package ${packageName} , load package and restart server or wait get notification for load package`
      );
    }

    return this.databaseAdapter.sortArgumentsAlgorithm(
      rawArguments,
      Object.values(this.packagesSettings.procedureObjectList).map((item) =>
        item.toLowerCase()
      ) as Array<Lowercase<string>>,
      packageName,
      this.packagesSettings.packages.length
    );
  }

  private decodeProcedureArgument(
    value: unknown,
    index: number
  ): IProcedureArgumentBase {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ServerError(
        `Invalid procedure metadata row ${index + 1}: expected an object`
      );
    }
    const record = value as Record<string, unknown>;
    const readString = (key: string): string => {
      const candidate = record[key];
      if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        throw new ServerError(
          `Invalid procedure metadata row ${index + 1}: ${key} must be a non-empty string`
        );
      }
      return candidate.trim();
    };

    const rawMode = readString('mode').toUpperCase().replaceAll(' ', '');
    let mode: TProcedureArgumentMode;
    if (rawMode === 'IN') mode = 'IN';
    else if (rawMode === 'OUT') mode = 'OUT';
    else if (rawMode === 'INOUT' || rawMode === 'IN/OUT') mode = 'IN/OUT';
    else
      throw new ServerError(
        `Invalid procedure metadata row ${index + 1}: unsupported mode ${rawMode}`
      );

    const rawOrder = record.order;
    const order =
      typeof rawOrder === 'number' ||
      (typeof rawOrder === 'string' && rawOrder.trim().length > 0)
        ? Number(rawOrder)
        : Number.NaN;
    if (!Number.isSafeInteger(order) || order < 0) {
      throw new ServerError(
        `Invalid procedure metadata row ${index + 1}: order must be a non-negative safe integer`
      );
    }

    const rawSize = record.size;
    let size: number | undefined;
    if (rawSize !== undefined && rawSize !== null) {
      const parsedSize =
        typeof rawSize === 'number' || typeof rawSize === 'string'
          ? Number(rawSize)
          : Number.NaN;
      if (!Number.isSafeInteger(parsedSize) || parsedSize <= 0) {
        throw new ServerError(
          `Invalid procedure metadata row ${index + 1}: size must be a positive safe integer`
        );
      }
      size = parsedSize;
    }

    const readOptionalString = (key: string): string | undefined => {
      const candidate = record[key];
      if (candidate === undefined || candidate === null) return undefined;
      if (typeof candidate !== 'string' || candidate.trim().length === 0) {
        throw new ServerError(
          `Invalid procedure metadata row ${index + 1}: ${key} must be a non-empty string when provided`
        );
      }
      return candidate.trim();
    };
    const rawSubprogramId = record.subprogramId;
    let subprogramId: number | undefined;
    if (rawSubprogramId !== undefined && rawSubprogramId !== null) {
      const parsedSubprogramId =
        typeof rawSubprogramId === 'number' ||
        typeof rawSubprogramId === 'string'
          ? Number(rawSubprogramId)
          : Number.NaN;
      if (
        !Number.isSafeInteger(parsedSubprogramId) ||
        parsedSubprogramId <= 0
      ) {
        throw new ServerError(
          `Invalid procedure metadata row ${index + 1}: subprogramId must be a positive safe integer`
        );
      }
      subprogramId = parsedSubprogramId;
    }

    const specificName = readOptionalString('specificName');
    const owner = readOptionalString('owner');
    const overload = readOptionalString('overload');

    return {
      procedureName: readString('procedureName'),
      argumentName: readString('argumentName'),
      argumentType: readString('argumentType'),
      order,
      mode,
      ...(size === undefined ? {} : { size }),
      ...(specificName === undefined ? {} : { specificName }),
      ...(owner === undefined ? {} : { owner }),
      ...(subprogramId === undefined ? {} : { subprogramId }),
      ...(overload === undefined ? {} : { overload }),
    };
  }

  public async initPackagesMap(): Promise<void> {
    if (!this.packagesSettings) return;

    await Promise.all(
      this.packagesSettings.packages.map((item) =>
        this.fetchProcedureListWithArguments(
          item.toLowerCase() as Lowercase<string>
        )
      )
    );
  }

  /** Stops retries and releases the instance-local parser cache. */
  public destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.isDestroyed = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.destroyPromise = this.destroyInternal();
    return this.destroyPromise;
  }

  private async destroyInternal(): Promise<void> {
    await Promise.allSettled(this.activeFetchPromises);
    this.packageFetchStates.clear();
    this.procedureNameParser.destroy();
    this.packagesWithProceduresList = new Map();
  }
}
