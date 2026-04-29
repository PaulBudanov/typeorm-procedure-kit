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

  it('releases entity managers and swallows release errors', async (): Promise<void> => {
    const logger = createLogger();
    const connectionBase = new ConnectionBase({} as never, logger);
    const releaseError = new Error('release failed');
    const manager = {
      release: vi.fn<() => Promise<void>>().mockRejectedValue(releaseError),
    };

    await expect(
      connectionBase.releaseEntityManager(manager as never)
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Connection release error, err: release failed',
      releaseError.stack
    );
  });
});
