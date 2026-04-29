import { vi } from 'vitest';

import type { IDatabaseAdapterContract } from '../../src/types/adapter.types.js';
import type { ILoggerModule } from '../../src/types/logger.types.js';
import type { TSerializerTypeCastWithoutFormat } from '../../src/types/serializer.types.js';

type LoggerMock = ReturnType<
  typeof vi.fn<(message: unknown, stack?: string, context?: string) => void>
>;

export interface TestLogger extends ILoggerModule {
  error: LoggerMock;
  log: LoggerMock;
  warn: LoggerMock;
  debug: LoggerMock;
  verbose: LoggerMock;
}

export function createLogger(): TestLogger {
  return {
    error:
      vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
    log: vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
    warn: vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
    debug:
      vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
    verbose:
      vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
  } as TestLogger;
}

export function createAdapterMock(
  overrides: Partial<IDatabaseAdapterContract> = {}
): IDatabaseAdapterContract {
  const serializerMapping: TSerializerTypeCastWithoutFormat = new Map();
  return {
    sortArgumentsAlgorithm: vi.fn(),
    execute: vi.fn(),
    generatePackageInfoSql: vi.fn(),
    makeSqlBindings: vi.fn(),
    makeBindings: vi.fn(),
    setSerializer: vi.fn(),
    deleteSerializer: vi.fn(),
    deleteAllSerializers: vi.fn(),
    serializerMapping,
    listenNotify: vi.fn(),
    unlistenNotify: vi.fn(),
    destroyNotifications: vi.fn(),
    getNotificationPool: vi.fn((): Map<string, unknown> => new Map()),
    getPackagesNotifySql: vi.fn(),
    registerFetchHandlerHook: vi.fn(),
    ...overrides,
  } as IDatabaseAdapterContract;
}
