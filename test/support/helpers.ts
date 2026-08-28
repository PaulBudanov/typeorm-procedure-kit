import { vi } from 'vitest';

import type { IDatabaseAdapterContract } from '../../src/types/adapter.types.js';
import type { ILoggerModule } from '../../src/types/logger.types.js';
import type { TSerializerTypeCastWithoutFormat } from '../../src/types/serializer.types.js';

type TLoggerMock = ReturnType<
  typeof vi.fn<(message: unknown, stack?: string, context?: string) => void>
>;

export interface ITestLogger extends ILoggerModule {
  error: TLoggerMock;
  log: TLoggerMock;
  warn: TLoggerMock;
}

export function createLogger(): ITestLogger {
  return {
    error:
      vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
    log: vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
    warn: vi.fn<(message: unknown, stack?: string, context?: string) => void>(),
  } as ITestLogger;
}

export function createAdapterMock(
  overrides: Partial<IDatabaseAdapterContract> = {}
): IDatabaseAdapterContract {
  const serializerMapping: TSerializerTypeCastWithoutFormat = new Map();
  return {
    sortArgumentsAlgorithm: vi.fn(),
    execute: vi.fn(),
    executeProcedure: vi.fn(),
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
