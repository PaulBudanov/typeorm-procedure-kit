import { ServerError } from '../../utils/server-error.js';

import type { IResourceLimits } from '../../types/config.types.js';

/** Incremental row/byte accounting shared by procedure materializers. */
export class ProcedureResourceTracker {
  private static readonly MAX_CACHED_KEYS = 512;
  private static readonly keyByteLengths = new Map<string, number>();
  private materializedBytes = 0;
  private materializedRows = 0;
  private rowShape?: { keys: Array<string>; keyBytes: Array<number> };

  public constructor(
    private readonly vendor: 'Oracle' | 'PostgreSQL',
    private readonly limits: Readonly<IResourceLimits>
  ) {}

  public get remainingRows(): number {
    return this.limits.maxProcedureRows - this.materializedRows;
  }

  public addValue(value: unknown): void {
    this.materializedBytes += this.measureValue(value);
    if (this.materializedBytes > this.limits.maxProcedureBytes) {
      throw new ServerError(
        `${this.vendor} procedure result exceeds resourceLimits.maxProcedureBytes (${this.limits.maxProcedureBytes})`
      );
    }
  }

  public addRow(row: unknown): void {
    this.materializedRows += 1;
    if (this.materializedRows > this.limits.maxProcedureRows) {
      throw new ServerError(
        `${this.vendor} procedure result exceeds resourceLimits.maxProcedureRows (${this.limits.maxProcedureRows})`
      );
    }
    this.materializedBytes += this.measureRow(row);
    if (this.materializedBytes > this.limits.maxProcedureBytes) {
      throw new ServerError(
        `${this.vendor} procedure result exceeds resourceLimits.maxProcedureBytes (${this.limits.maxProcedureBytes})`
      );
    }
  }

  /**
   * Fast path for the flat records returned by database drivers. If a nested
   * object is found, the generic graph walker restarts to preserve cycle and
   * repeated-reference accounting exactly.
   */
  private measureRow(value: unknown): number {
    if (value === null || typeof value !== 'object') {
      return this.measureValue(value);
    }
    const rowScalarBytes = this.measureScalar(value);
    if (rowScalarBytes !== undefined) return rowScalarBytes;

    let bytes = 0;
    const cachedShape = this.rowShape;
    let isShapeChanged = cachedShape === undefined;
    let nextKeys: Array<string> | undefined = isShapeChanged ? [] : undefined;
    let nextKeyBytes: Array<number> | undefined = isShapeChanged
      ? []
      : undefined;
    let keyIndex = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      let keyBytes: number;
      if (!isShapeChanged && cachedShape?.keys[keyIndex] === key) {
        keyBytes = cachedShape.keyBytes[keyIndex] ?? this.measureKey(key);
      } else {
        if (!isShapeChanged) {
          isShapeChanged = true;
          nextKeys = cachedShape?.keys.slice(0, keyIndex) ?? [];
          nextKeyBytes = cachedShape?.keyBytes.slice(0, keyIndex) ?? [];
        }
        keyBytes = this.measureKey(key);
        nextKeys?.push(key);
        nextKeyBytes?.push(keyBytes);
      }
      keyIndex += 1;
      bytes += keyBytes;
      const nestedValue = (value as Record<string, unknown>)[key];
      const nestedBytes = this.measureScalar(nestedValue);
      if (nestedBytes === undefined) return this.measureValue(value);
      bytes += nestedBytes;
    }
    if (
      !isShapeChanged &&
      cachedShape &&
      keyIndex !== cachedShape.keys.length
    ) {
      this.rowShape = {
        keys: cachedShape.keys.slice(0, keyIndex),
        keyBytes: cachedShape.keyBytes.slice(0, keyIndex),
      };
    } else if (isShapeChanged && nextKeys && nextKeyBytes) {
      this.rowShape = { keys: nextKeys, keyBytes: nextKeyBytes };
    }
    return bytes;
  }

  private measureValue(value: unknown): number {
    const scalarBytes = this.measureScalar(value);
    if (scalarBytes !== undefined) return scalarBytes;
    return this.measureObjectGraph(value);
  }

  /** Iterative walk that charges every reachable object exactly once. */
  private measureObjectGraph(root: unknown): number {
    let bytes = 0;
    const objectGraph = new WeakSet();
    const pendingObjects: Array<unknown> = [root];
    while (pendingObjects.length > 0) {
      const current = pendingObjects.pop();
      if (current === null || typeof current !== 'object') continue;
      if (objectGraph.has(current)) continue;
      objectGraph.add(current);

      for (const key in current) {
        if (!Object.hasOwn(current, key)) continue;
        bytes += this.measureKey(key);
        const nestedValue = (current as Record<string, unknown>)[key];
        const nestedBytes = this.measureScalar(nestedValue);
        if (nestedBytes === undefined) {
          pendingObjects.push(nestedValue);
          continue;
        }
        bytes += nestedBytes;
      }
    }
    return bytes;
  }

  /**
   * The single dispatcher for "how many bytes does this value occupy?". Both
   * the `measureRow` fast path and the graph walk route every value through it,
   * so the two paths cannot report different sizes for the same value.
   *
   * Returns `undefined` for a value that still has to be walked as an object
   * graph, and `0` for a value that carries no payload of its own.
   */
  private measureScalar(value: unknown): number | undefined {
    if (value === null || value === undefined) return 0;
    if (Buffer.isBuffer(value)) return value.byteLength;
    switch (typeof value) {
      case 'string':
        return this.measureUtf8(value);
      case 'number':
        return this.measureNumber(value);
      case 'bigint':
        return String(value).length;
      case 'boolean':
        return 1;
      case 'object':
        if (value instanceof Date) return value.toISOString().length;
        return undefined;
      default:
        return 0;
    }
  }

  /**
   * Memoises key sizes across procedure calls. The cache is process-wide, and
   * keys come from result data (including keys nested inside JSON values), not
   * just from the schema, so it must evict rather than stop accepting entries:
   * a burst of high-cardinality keys would otherwise pin the first
   * MAX_CACHED_KEYS strings for the life of the process and leave the cache
   * permanently unable to memoise the keys that are actually hot - including
   * for any tracker created after a `destroy()` and re-initialisation.
   */
  private measureKey(key: string): number {
    const cached = ProcedureResourceTracker.keyByteLengths.get(key);
    if (cached !== undefined) return cached;
    const bytes = this.measureUtf8(key);
    if (
      ProcedureResourceTracker.keyByteLengths.size >=
      ProcedureResourceTracker.MAX_CACHED_KEYS
    ) {
      ProcedureResourceTracker.keyByteLengths.clear();
    }
    ProcedureResourceTracker.keyByteLengths.set(key, bytes);
    return bytes;
  }

  /** Avoids allocating decimal strings for the common integer database types. */
  private measureNumber(value: number): number {
    if (!Number.isSafeInteger(value)) return String(value).length;
    if (value < 0) return this.measureUnsignedInteger(-value) + 1;
    return this.measureUnsignedInteger(value);
  }

  private measureUnsignedInteger(value: number): number {
    if (value < 10) return 1;
    if (value < 100) return 2;
    if (value < 1_000) return 3;
    if (value < 10_000) return 4;
    if (value < 100_000) return 5;
    if (value < 1_000_000) return 6;
    if (value < 10_000_000) return 7;
    if (value < 100_000_000) return 8;
    if (value < 1_000_000_000) return 9;
    if (value < 10_000_000_000) return 10;
    if (value < 100_000_000_000) return 11;
    if (value < 1_000_000_000_000) return 12;
    if (value < 10_000_000_000_000) return 13;
    if (value < 100_000_000_000_000) return 14;
    if (value < 1_000_000_000_000_000) return 15;
    return 16;
  }

  /** Exact UTF-8 length without allocating a Buffer for common short text. */
  private measureUtf8(value: string): number {
    let bytes = value.length;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) continue;
      if (code <= 0x7ff) {
        bytes += 1;
        continue;
      }
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 2;
          index += 1;
          continue;
        }
      }
      bytes += 2;
    }
    return bytes;
  }
}
