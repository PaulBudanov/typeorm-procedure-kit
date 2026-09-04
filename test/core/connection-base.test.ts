import { describe, expect, it, vi } from 'vitest';

import { ConnectionBase } from '../../src/core/connection-base.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

describe('ConnectionBase', (): void => {
  it('returns connected entity manager from initialized data source', async (): Promise<void> => {
    const manager = { connection: { isInitialized: true } };
    const queryRunner = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      manager,
    };
    const dataSource = {
      isInitialized: true,
      options: { replication: { slaves: [{}] } },
      createQueryRunner: vi.fn(
        (_mode: string): typeof queryRunner => queryRunner
      ),
    };
    const connectionBase = new ConnectionBase(
      dataSource as never,
      createLogger()
    );

    await expect(connectionBase.getEntityManager('slave')).resolves.toBe(
      manager
    );
    expect(dataSource.createQueryRunner).toHaveBeenCalledWith('slave');
    expect(queryRunner.connect).toHaveBeenCalledOnce();
  });

  it('warns and lets driver fallback use master when slave mode is requested without configured slaves', async (): Promise<void> => {
    const logger = createLogger();
    const manager = { connection: { isInitialized: true } };
    const queryRunner = {
      connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      manager,
    };
    const dataSource = {
      isInitialized: true,
      options: {},
      createQueryRunner: vi.fn(
        (_mode: string): typeof queryRunner => queryRunner
      ),
    };
    const connectionBase = new ConnectionBase(dataSource as never, logger);

    await expect(connectionBase.getEntityManager('slave')).resolves.toBe(
      manager
    );
    expect(dataSource.createQueryRunner).toHaveBeenCalledWith('slave');
    expect(queryRunner.connect).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'Slave connection requested but no slave databases configured. Using master connection.'
    );
  });

  it('throws and logs when data source is not initialized', async (): Promise<void> => {
    const logger = createLogger();
    const connectionBase = new ConnectionBase(
      { isInitialized: false } as never,
      logger
    );

    await expect(connectionBase.getEntityManager()).rejects.toThrow(
      ServerError
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Error getting connection from pool',
      expect.any(String)
    );
  });

  it('releases a query runner when acquisition fails after it was created', async (): Promise<void> => {
    const logger = createLogger();
    const acquisitionError = new Error('connect failed');
    const queryRunner = {
      isReleased: false,
      connect: vi.fn<() => Promise<void>>().mockRejectedValue(acquisitionError),
      release: vi.fn<(_error?: Error) => Promise<void>>().mockResolvedValue(),
      manager: { connection: { isInitialized: true } },
    };
    const connectionBase = new ConnectionBase(
      {
        isInitialized: true,
        options: {},
        createQueryRunner: (): typeof queryRunner => queryRunner,
      } as never,
      logger
    );

    await expect(connectionBase.getEntityManager()).rejects.toBe(
      acquisitionError
    );
    expect(queryRunner.release).toHaveBeenCalledWith(acquisitionError);
  });

  it('surfaces entity manager release errors after logging them', async (): Promise<void> => {
    const logger = createLogger();
    const connectionBase = new ConnectionBase({} as never, logger);
    const releaseError = new Error('release failed');
    const manager = {
      release: vi.fn<() => Promise<void>>().mockRejectedValue(releaseError),
    };

    await expect(
      connectionBase.releaseEntityManager(manager as never)
    ).rejects.toBe(releaseError);
    expect(logger.error).toHaveBeenCalledWith(
      'Connection release error, err: release failed',
      releaseError.stack
    );
  });

  it('preserves acquisition and cleanup errors when both fail', async (): Promise<void> => {
    const logger = createLogger();
    const acquisitionError = new Error('connect failed');
    const cleanupError = new Error('release failed');
    const queryRunner = {
      isReleased: false,
      connect: vi.fn<() => Promise<void>>().mockRejectedValue(acquisitionError),
      release: vi
        .fn<(_error?: Error) => Promise<void>>()
        .mockRejectedValue(cleanupError),
      manager: { connection: { isInitialized: true } },
    };
    const connectionBase = new ConnectionBase(
      {
        isInitialized: true,
        options: {},
        createQueryRunner: (): typeof queryRunner => queryRunner,
      } as never,
      logger
    );

    const result = connectionBase.getEntityManager();

    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({
      errors: [acquisitionError, cleanupError],
      cause: acquisitionError,
    });
  });
});
