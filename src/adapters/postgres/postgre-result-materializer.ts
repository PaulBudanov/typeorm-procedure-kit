import { DEFAULT_RESOURCE_LIMITS } from '../../utils/resource-limits.js';
import { ServerError } from '../../utils/server-error.js';
import { ProcedureResourceTracker } from '../abstract/procedure-resource-tracker.js';

import {
  assertSupportedPostgreComposite,
  quotePostgreCompositeType,
} from './postgre-composite.js';
import { PostgreUnnamedPortalError } from './postgre-portal-name.js';

import type { PostgrePortalName } from './postgre-portal-name.js';
import type {
  IPortalOutput,
  IPostgreValueSerializer,
} from '../../interfaces/postgre-result-materializer.interfaces.js';
import type { EntityManager } from '../../typeorm/entity-manager/EntityManager.js';
import type { IRegisteredFetchHandlerOptions } from '../../types/adapter.types.js';
import type { ILoggerModule } from '../../types/logger.types.js';
import type {
  IProcedureStructuredField,
  IProcedureStructuredType,
} from '../../types/procedure.types.js';
import type { TSerializerType } from '../../types/serializer.types.js';
import type {
  IProcedureOutBinding,
  IProcedureResult,
} from '../../types/utility.types.js';

/** Materializes PostgreSQL scalar outputs and refcursor portals. */
export class PostgreProcedureResultMaterializer {
  private static readonly CURSOR_FETCH_BATCH_SIZE = 1000;

  public constructor(
    private readonly logger: ILoggerModule,
    private readonly options: IRegisteredFetchHandlerOptions,
    private readonly portalNames: PostgrePortalName,
    private readonly serializer: IPostgreValueSerializer
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
      const compositeOutputs = await this.loadCompositeOutputs(
        executeResult.manager,
        outBindings,
        outputRecord,
        outputKeys
      );
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
          const scalarValue =
            outBinding.structuredType === undefined
              ? this.readOutputValue(
                  outputRecord,
                  outputKeys,
                  outBinding.name,
                  outputName
                )
              : compositeOutputs.get(outBinding.name);
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

  /** Converts every composite OUT value in one transaction-local SQL batch. */
  private async loadCompositeOutputs(
    manager: EntityManager,
    outBindings: Array<IProcedureOutBinding>,
    outputRecord: Record<string, unknown>,
    outputKeys: ReadonlyMap<string, string>
  ): Promise<ReadonlyMap<string, unknown>> {
    const compositeBindings = outBindings.filter(
      (
        binding
      ): binding is IProcedureOutBinding & {
        structuredType: IProcedureStructuredType;
      } => binding.structuredType !== undefined
    );
    if (compositeBindings.length === 0) return new Map();

    const bindings: Array<unknown> = [];
    const selectExpressions = compositeBindings.map((binding, index) => {
      const structuredType = binding.structuredType;
      assertSupportedPostgreComposite(binding.databaseType, structuredType);
      const outputName = this.options.caseStrategy.transformColumnName(
        binding.name
      );
      bindings.push(
        this.readOutputValue(
          outputRecord,
          outputKeys,
          binding.name,
          outputName
        ) ?? null
      );
      const qualifiedType = quotePostgreCompositeType(structuredType);
      return `to_jsonb($${index + 1}::${qualifiedType})::text AS "tpk_composite_${index}"`;
    });
    const conversionRows = await manager.query<Array<Record<string, unknown>>>(
      `SELECT ${selectExpressions.join(', ')}`,
      bindings
    );
    const conversionRow = conversionRows[0];
    if (conversionRow === undefined) {
      throw new ServerError(
        'PostgreSQL composite conversion did not return a row'
      );
    }
    const conversionKeys = this.indexOutputKeys(conversionRow);
    const outputs = new Map<string, unknown>();
    for (const [index, binding] of compositeBindings.entries()) {
      const alias = `tpk_composite_${index}`;
      const rawKey = conversionKeys.get(alias) ?? alias;
      outputs.set(
        binding.name,
        this.materializeCompositeValue(
          conversionRow[rawKey],
          binding.structuredType,
          binding.name
        )
      );
    }
    return outputs;
  }

  private materializeCompositeValue(
    value: unknown,
    structuredType: IProcedureStructuredType,
    bindingName: string
  ): unknown {
    if (value === null || value === undefined) return null;
    let parsedValue: unknown = value;
    if (typeof value === 'string') {
      try {
        parsedValue = JSON.parse(value) as unknown;
      } catch (error: unknown) {
        throw new ServerError(
          `PostgreSQL composite output "${bindingName}" returned invalid JSON`,
          error,
          { cause: error }
        );
      }
    }
    if (
      parsedValue === null ||
      typeof parsedValue !== 'object' ||
      Array.isArray(parsedValue)
    ) {
      throw new ServerError(
        `PostgreSQL composite output "${bindingName}" must be an object or null`
      );
    }
    return this.transformCompositeRecord(
      parsedValue as Record<string, unknown>,
      structuredType,
      bindingName
    );
  }

  private transformCompositeRecord(
    value: Record<string, unknown>,
    structuredType: IProcedureStructuredType,
    bindingName: string
  ): Record<string, unknown> {
    const sourceKeys = this.indexOutputKeys(value);
    const fieldNames = new Set(
      structuredType.fields.map((field) => field.name.toLowerCase())
    );
    const unknownKey = Object.keys(value).find(
      (key) => !fieldNames.has(key.toLowerCase())
    );
    if (unknownKey !== undefined) {
      throw new ServerError(
        `Unknown field "${unknownKey}" in PostgreSQL composite output "${bindingName}"`
      );
    }

    const result: Record<string, unknown> = {};
    for (const field of structuredType.fields) {
      const outputName = this.options.caseStrategy.transformColumnName(
        field.name
      );
      if (Object.hasOwn(result, outputName)) {
        throw new ServerError(
          `PostgreSQL composite output "${bindingName}" has conflicting transformed field "${outputName}"`
        );
      }
      const sourceKey = sourceKeys.get(field.name.toLowerCase());
      result[outputName] = this.serializeCompositeField(
        field,
        sourceKey === undefined ? null : value[sourceKey],
        outputName
      );
    }
    return result;
  }

  private serializeCompositeField(
    field: IProcedureStructuredField,
    value: unknown,
    outputName: string
  ): unknown {
    const serializerType = this.getSerializerType(field.argumentType);
    if (serializerType === undefined) return value ?? null;
    return this.serializer.serializeValue(serializerType, value, {
      source: 'scalar-out',
      database: 'postgres',
      name: outputName,
      databaseType: field.argumentType,
    });
  }

  private getSerializerType(databaseType: string): TSerializerType | undefined {
    const normalizedType = databaseType.trim().toLowerCase();
    if (normalizedType === 'date') return 'DATE';
    if (/^timestamp(?:\(\d+\))? with time zone$/u.test(normalizedType))
      return 'TIMESTAMP_TZ';
    if (/^timestamp(?:\(\d+\))? without time zone$/u.test(normalizedType))
      return 'TIMESTAMP';
    if (/^timestamp(?:\(\d+\))?$/u.test(normalizedType)) return 'TIMESTAMP';
    if (normalizedType === 'boolean' || normalizedType === 'bool')
      return 'BOOLEAN';
    if (normalizedType.startsWith('character varying')) return 'VARCHAR';
    if (normalizedType === 'varchar') return 'VARCHAR';
    if (normalizedType.startsWith('character(')) return 'CHAR';
    if (normalizedType === 'character' || normalizedType === 'char')
      return 'CHAR';
    if (normalizedType === 'json' || normalizedType === 'jsonb') return 'JSON';
    if (normalizedType === 'bytea') return 'BINARY';
    if (normalizedType === 'xml') return 'XML';
    return undefined;
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
