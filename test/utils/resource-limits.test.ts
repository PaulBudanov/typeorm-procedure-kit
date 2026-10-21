import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESOURCE_LIMITS,
  resolveResourceLimits,
} from '../../src/utils/resource-limits.js';
import { ServerError } from '../../src/utils/server-error.js';

import type { IResourceLimits } from '../../src/types/config.types.js';

const LIMIT_NAMES: ReadonlyArray<keyof IResourceLimits> = [
  'maxProcedureRows',
  'maxProcedureBytes',
  'maxMetadataRows',
  'maxLobBytes',
  'maxNotificationQueue',
  'maxNotificationRows',
];

const INVALID_LIMIT_CASES: ReadonlyArray<{
  name: keyof IResourceLimits;
  value: number;
}> = LIMIT_NAMES.flatMap((name) =>
  [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN].map((value) => ({
    name,
    value,
  }))
);

describe('resolveResourceLimits', (): void => {
  it('returns the defaults when no limits are configured', (): void => {
    expect(resolveResourceLimits(undefined)).toEqual({
      maxProcedureRows: 100_000,
      maxProcedureBytes: 64 * 1024 * 1024,
      maxMetadataRows: 10_000,
      maxLobBytes: 16 * 1024 * 1024,
      maxNotificationQueue: 1_000,
      maxNotificationRows: 10_000,
    });
  });

  it('keeps the default for maxLobBytes set to undefined', (): void => {
    expect(resolveResourceLimits({ maxLobBytes: undefined })).toEqual({
      maxProcedureRows: 100_000,
      maxProcedureBytes: 64 * 1024 * 1024,
      maxMetadataRows: 10_000,
      maxLobBytes: 16 * 1024 * 1024,
      maxNotificationQueue: 1_000,
      maxNotificationRows: 10_000,
    });
  });

  it.each(LIMIT_NAMES)(
    'keeps the default for %s set to undefined',
    (name): void => {
      const resolved = resolveResourceLimits({ [name]: undefined });

      expect(resolved[name]).toBe(DEFAULT_RESOURCE_LIMITS[name]);
      expect(resolved).toEqual(DEFAULT_RESOURCE_LIMITS);
    }
  );

  it('keeps the defaults when every limit is set to undefined', (): void => {
    expect(
      resolveResourceLimits({
        maxProcedureRows: undefined,
        maxProcedureBytes: undefined,
        maxMetadataRows: undefined,
        maxLobBytes: undefined,
        maxNotificationQueue: undefined,
        maxNotificationRows: undefined,
      })
    ).toEqual(DEFAULT_RESOURCE_LIMITS);
  });

  it('applies configured limits next to undefined ones', (): void => {
    expect(
      resolveResourceLimits({ maxProcedureRows: 25, maxLobBytes: undefined })
    ).toEqual({
      maxProcedureRows: 25,
      maxProcedureBytes: 64 * 1024 * 1024,
      maxMetadataRows: 10_000,
      maxLobBytes: 16 * 1024 * 1024,
      maxNotificationQueue: 1_000,
      maxNotificationRows: 10_000,
    });
  });

  it('ignores keys that are not resource limits', (): void => {
    const limits: Partial<IResourceLimits> & { maxUnknown: number } = {
      maxLobBytes: 7,
      maxUnknown: 0,
    };

    expect(resolveResourceLimits(limits)).toEqual({
      ...DEFAULT_RESOURCE_LIMITS,
      maxLobBytes: 7,
    });
  });

  it.each(INVALID_LIMIT_CASES)(
    'rejects $name set to $value with a ServerError naming the option',
    ({ name, value }): void => {
      const resolve = (): Readonly<IResourceLimits> =>
        resolveResourceLimits({ [name]: value });

      expect(resolve).toThrow(ServerError);
      expect(resolve).toThrow(
        `resourceLimits.${name} must be a positive safe integer`
      );
    }
  );

  it('returns a frozen object', (): void => {
    expect(Object.isFrozen(resolveResourceLimits(undefined))).toBe(true);
    expect(
      Object.isFrozen(resolveResourceLimits({ maxLobBytes: undefined }))
    ).toBe(true);
    expect(Object.isFrozen(resolveResourceLimits({ maxLobBytes: 5 }))).toBe(
      true
    );
  });

  it('does not freeze or change the configured object', (): void => {
    const limits: Partial<IResourceLimits> = {
      maxProcedureRows: 25,
      maxLobBytes: undefined,
    };

    resolveResourceLimits(limits);

    expect(Object.isFrozen(limits)).toBe(false);
    expect(limits).toStrictEqual({
      maxProcedureRows: 25,
      maxLobBytes: undefined,
    });
  });
});
