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

export function resolveResourceLimits(
  limits: Partial<IResourceLimits> | undefined
): Readonly<IResourceLimits> {
  const resolved: IResourceLimits = {
    ...DEFAULT_RESOURCE_LIMITS,
    ...limits,
  };
  return Object.freeze({
    maxProcedureRows: assertPositiveInteger(
      resolved.maxProcedureRows,
      'resourceLimits.maxProcedureRows'
    ),
    maxProcedureBytes: assertPositiveInteger(
      resolved.maxProcedureBytes,
      'resourceLimits.maxProcedureBytes'
    ),
    maxMetadataRows: assertPositiveInteger(
      resolved.maxMetadataRows,
      'resourceLimits.maxMetadataRows'
    ),
    maxLobBytes: assertPositiveInteger(
      resolved.maxLobBytes,
      'resourceLimits.maxLobBytes'
    ),
    maxNotificationQueue: assertPositiveInteger(
      resolved.maxNotificationQueue,
      'resourceLimits.maxNotificationQueue'
    ),
    maxNotificationRows: assertPositiveInteger(
      resolved.maxNotificationRows,
      'resourceLimits.maxNotificationRows'
    ),
  });
}
