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
    if (
      value === null ||
      typeof value !== 'object' ||
      Buffer.isBuffer(value) ||
      value instanceof Date
    ) {
      return this.measureValue(value);
    }

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
      if (nestedValue === null || nestedValue === undefined) continue;
      if (typeof nestedValue === 'string') {
        bytes += this.measureUtf8(nestedValue);
        continue;
      }
      if (typeof nestedValue === 'number') {
        bytes += this.measureNumber(nestedValue);
        continue;
      }
      if (typeof nestedValue === 'boolean') {
        bytes += 1;
        continue;
      }
      if (typeof nestedValue === 'bigint') {
        bytes += String(nestedValue).length;
        continue;
      }
      if (Buffer.isBuffer(nestedValue)) {
        bytes += nestedValue.byteLength;
        continue;
      }
      if (nestedValue instanceof Date) {
        bytes += nestedValue.toISOString().length;
        continue;
      }
      if (typeof nestedValue === 'object') return this.measureValue(value);
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

  private measureValue(value: unknown, visited?: Set<object>): number {
    if (value === null || value === undefined) return 0;
    if (Buffer.isBuffer(value)) return value.byteLength;
    if (typeof value === 'string') return this.measureUtf8(value);
    if (typeof value === 'number') return this.measureNumber(value);
    if (typeof value === 'bigint') return String(value).length;
    if (typeof value === 'boolean') return 1;
    if (value instanceof Date) return value.toISOString().length;
    if (typeof value !== 'object') return 0;
    if (visited?.has(value)) return 0;
    visited?.add(value);

    let bytes = 0;
    let objectGraph = visited;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      bytes += this.measureKey(key);
      const nestedValue = (value as Record<string, unknown>)[key];
      if (nestedValue === null || nestedValue === undefined) continue;
      if (Buffer.isBuffer(nestedValue)) {
        bytes += nestedValue.byteLength;
        continue;
      }
      if (typeof nestedValue === 'string') {
        bytes += this.measureUtf8(nestedValue);
        continue;
      }
      if (typeof nestedValue === 'number') {
        bytes += this.measureNumber(nestedValue);
        continue;
      }
      if (typeof nestedValue === 'bigint') {
        bytes += String(nestedValue).length;
        continue;
      }
      if (typeof nestedValue === 'boolean') {
        bytes += 1;
        continue;
      }
      if (nestedValue instanceof Date) {
        bytes += nestedValue.toISOString().length;
        continue;
      }
      if (typeof nestedValue === 'object') {
        if (objectGraph === undefined) {
          objectGraph = new Set<object>([value]);
        }
        bytes += this.measureValue(nestedValue, objectGraph);
      }
    }
    return bytes;
  }

  private measureKey(key: string): number {
    const cached = ProcedureResourceTracker.keyByteLengths.get(key);
    if (cached !== undefined) return cached;
    const bytes = this.measureUtf8(key);
    if (
      ProcedureResourceTracker.keyByteLengths.size <
      ProcedureResourceTracker.MAX_CACHED_KEYS
    ) {
      ProcedureResourceTracker.keyByteLengths.set(key, bytes);
    }
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
