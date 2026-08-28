import { DEFAULT_RESOURCE_LIMITS } from '../../utils/resource-limits.js';
import { ServerError } from '../../utils/server-error.js';
import { ProcedureResourceTracker } from '../abstract/procedure-resource-tracker.js';

import { PostgreUnnamedPortalError } from './postgre-portal-name.js';

import type { PostgrePortalName } from './postgre-portal-name.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  IProcedureOutBinding,
  IProcedureResult,
} from '../../types/utility.types.js';

interface IPortalOutput {
  outputName: string;
  portalName: string;
  quotedPortal: string;
}

/** Materializes PostgreSQL scalar outputs and refcursor portals. */
export class PostgreProcedureResultMaterializer {
  private static readonly CURSOR_FETCH_BATCH_SIZE = 1000;

  public constructor(
    private readonly logger: ILoggerModule,
    private readonly options: IRegisteredFetchHandlerOptions,
    private readonly portalNames: PostgrePortalName
  ) {}

  public async materialize<
    TRow,
    TOut extends Record<string, unknown> = Record<string, unknown>,
  >(
    cursorsNames: Array<string>,
    outBindings: Array<IProcedureOutBinding>,
    executeResult: { manager: EntityManager; result?: unknown }
  ): Promise<IProcedureResult<TRow, TOut>> {
    const rows: Array<TRow> = [];
    const outBinds: Record<string, unknown> = {};
    const firstResult: unknown = Array.isArray(executeResult.result)
      ? (executeResult.result as Array<unknown>)[0]
      : undefined;
    const outputRecord =
      firstResult !== null && typeof firstResult === 'object'
        ? (firstResult as Record<string, unknown>)
        : {};
    const outputKeys = this.indexOutputKeys(outputRecord);
    const cursorSet = new Set(cursorsNames);
    const tracker = new ProcedureResourceTracker(
      'PostgreSQL',
      this.options.resourceLimits ?? DEFAULT_RESOURCE_LIMITS
    );
    const portals = new Map<string, IPortalOutput>();
    const usedPortalNames = new Set<string>();

    try {
      for (const outBinding of outBindings) {
        if (outBinding.type !== 'cursor' && !cursorSet.has(outBinding.name)) {
          continue;
        }
        const outputName = this.options.caseStrategy.transformColumnName(
          outBinding.name
        );
        let portalName: string;
        try {
          portalName = this.portalNames.assertReturned(
            this.readOutputValue(
              outputRecord,
              outputKeys,
              outBinding.name,
              outputName
            ),
            outBinding.name
          );
        } catch (error: unknown) {
          if (error instanceof PostgreUnnamedPortalError) {
            portals.set(outBinding.name, {
              outputName,
              portalName: error.portalName,
              quotedPortal: this.portalNames.quote(error.portalName),
            });
          }
          throw error;
        }
        if (usedPortalNames.has(portalName)) {
          throw new ServerError(
            `PostgreSQL portal "${portalName}" was returned for more than one cursor output`
          );
        }
        usedPortalNames.add(portalName);
        portals.set(outBinding.name, {
          outputName,
          portalName,
          quotedPortal: this.portalNames.quote(portalName),
        });
      }

      for (const outBinding of outBindings) {
        const portal = portals.get(outBinding.name);
        if (!portal) {
          const outputName = this.options.caseStrategy.transformColumnName(
            outBinding.name
          );
          const scalarValue = this.readOutputValue(
            outputRecord,
            outputKeys,
            outBinding.name,
            outputName
          );
          tracker.addValue(scalarValue);
          outBinds[outputName] = scalarValue;
          continue;
        }

        portals.delete(outBinding.name);
        const cursorRows = await this.fetchAndClosePortal<TRow>(
          executeResult.manager,
          portal,
          tracker,
          rows
        );
        outBinds[portal.outputName] = cursorRows;
      }
    } finally {
      await this.closePendingPortals(executeResult.manager, portals.values());
    }

    return { rows, outBinds: outBinds as TOut };
  }

  private async fetchAndClosePortal<TRow>(
    manager: EntityManager,
    portal: IPortalOutput,
    tracker: ProcedureResourceTracker,
    allRows: Array<TRow>
  ): Promise<Array<TRow>> {
    const rows: Array<TRow> = [];
    let fetchError: unknown;
    let closeError: unknown;
    try {
      for (;;) {
        const fetchSize = Math.min(
          PostgreProcedureResultMaterializer.CURSOR_FETCH_BATCH_SIZE,
          tracker.remainingRows + 1
        );
        const batch = await manager.query<Array<TRow>>(
          `FETCH FORWARD ${fetchSize} FROM ${portal.quotedPortal}`
        );
        for (const row of batch) {
          tracker.addRow(row);
          rows.push(row);
          allRows.push(row);
        }
        if (batch.length < fetchSize) break;
      }
    } catch (error: unknown) {
      fetchError = error;
    } finally {
      try {
        await manager.query(`CLOSE ${portal.quotedPortal}`);
      } catch (error: unknown) {
        closeError = error;
        if (fetchError !== undefined) {
          this.logger.warn(
            `Failed to close PostgreSQL portal after fetch error: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
    if (fetchError !== undefined) {
      throw fetchError instanceof Error
        ? fetchError
        : ServerError.ENSURE_SERVER_ERROR({ error: fetchError });
    }
    if (closeError !== undefined) {
      throw closeError instanceof Error
        ? closeError
        : ServerError.ENSURE_SERVER_ERROR({ error: closeError });
    }
    return rows;
  }

  private async closePendingPortals(
    manager: EntityManager,
    portals: Iterable<IPortalOutput>
  ): Promise<void> {
    const closedNames = new Set<string>();
    for (const portal of portals) {
      if (closedNames.has(portal.portalName)) continue;
      closedNames.add(portal.portalName);
      try {
        await manager.query(`CLOSE ${portal.quotedPortal}`);
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to close pending PostgreSQL portal: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private indexOutputKeys(
    outputRecord: Record<string, unknown>
  ): ReadonlyMap<string, string> {
    const keys = new Map<string, string>();
    for (const key of Object.keys(outputRecord)) {
      const normalized = key.toLowerCase();
      if (!keys.has(normalized)) keys.set(normalized, key);
    }
    return keys;
  }

  private readOutputValue(
    outputRecord: Record<string, unknown>,
    outputKeys: ReadonlyMap<string, string>,
    bindingName: string,
    outputName: string
  ): unknown {
    const rawKey =
      outputKeys.get(bindingName.toLowerCase()) ??
      (Object.hasOwn(outputRecord, outputName) ? outputName : bindingName);
    return outputRecord[rawKey];
  }
}
