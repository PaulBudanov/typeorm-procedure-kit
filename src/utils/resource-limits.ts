import { ServerError } from './server-error.js';

import type { IResourceLimits } from '../types/config.types.js';

export const DEFAULT_RESOURCE_LIMITS: Readonly<IResourceLimits> = Object.freeze(
  {
    maxProcedureRows: 100_000,
    maxProcedureBytes: 64 * 1024 * 1024,
    maxMetadataRows: 10_000,
    maxLobBytes: 16 * 1024 * 1024,
    maxNotificationQueue: 1_000,
    maxNotificationRows: 10_000,
  }
);

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ServerError(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * Resolves one limit: an absent or `undefined` value keeps the default, any
 * other value must be a positive safe integer.
 */
function resolveLimit(
  configured: Partial<IResourceLimits>,
  name: keyof IResourceLimits
): number {
  const value = configured[name];
  if (value === undefined) {
    return DEFAULT_RESOURCE_LIMITS[name];
  }
  return assertPositiveInteger(value, `resourceLimits.${name}`);
}

/**
 * Resolves the configured resource limits against the defaults.
 *
 * Only own enumerable keys of `limits` are read, and a limit set to `undefined`
 * keeps its default. Unknown keys are ignored.
 * @param limits - Limits from `resourceLimits` in the kit config.
 * @returns A frozen object holding every limit.
 * @throws ServerError when a configured limit is not a positive safe integer.
 */
export function resolveResourceLimits(
  limits: Partial<IResourceLimits> | undefined
): Readonly<IResourceLimits> {
  const configured: Partial<IResourceLimits> = { ...limits };
  return Object.freeze({
    maxProcedureRows: resolveLimit(configured, 'maxProcedureRows'),
    maxProcedureBytes: resolveLimit(configured, 'maxProcedureBytes'),
    maxMetadataRows: resolveLimit(configured, 'maxMetadataRows'),
    maxLobBytes: resolveLimit(configured, 'maxLobBytes'),
    maxNotificationQueue: resolveLimit(configured, 'maxNotificationQueue'),
    maxNotificationRows: resolveLimit(configured, 'maxNotificationRows'),
  });
}
