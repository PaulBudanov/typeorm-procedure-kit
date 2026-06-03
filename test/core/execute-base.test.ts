import { describe, expect, it, vi } from 'vitest';

import { ExecuteBase } from '../../src/core/execute-base.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

describe('ExecuteBase', (): void => {
  it('executes through adapter, checks errors, and releases manager', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi
        .fn<(_manager: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const adapter = createAdapterMock({
      execute: vi.fn().mockResolvedValue([{ id: 1 }]),
    });
    const executeBase = new ExecuteBase(
      connectionBase as never,
      adapter,
      createLogger()
    );

    await expect(
      executeBase.execute('select 1', [1], [], {
        optionsCommands: ['SET LOCAL role = app'],
        queryId: 'query-1',
      })
    ).resolves.toEqual([{ id: 1 }]);

    expect(connectionBase.getEntityManager).toHaveBeenCalledWith('master');
    expect(adapter.execute).toHaveBeenCalledWith(
      'select 1',
      manager,
      ['SET LOCAL role = app'],
      [1],
      []
    );
    expect(connectionBase.releaseEntityManager).toHaveBeenCalledWith(manager);
  });

  it('uses slave connection mode when requested', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi
        .fn<(_manager: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const adapter = createAdapterMock({
      execute: vi.fn().mockResolvedValue([{ id: 1 }]),
    });
    const executeBase = new ExecuteBase(
      connectionBase as never,
      adapter,
      createLogger()
    );

    await expect(
      executeBase.execute('select 1', [], [], {
        mode: 'slave',
        queryId: 'query-1',
      })
    ).resolves.toEqual([{ id: 1 }]);

    expect(connectionBase.getEntityManager).toHaveBeenCalledWith('slave');
  });

  it('wraps adapter errors as ServerError and still releases manager', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi
        .fn<(_manager: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const adapter = createAdapterMock({
      execute: vi.fn().mockRejectedValue(new Error('bad query')),
    });
    const executeBase = new ExecuteBase(
      connectionBase as never,
      adapter,
      createLogger()
    );

    await expect(
      executeBase.execute('select 1', [], [], { queryId: 'query-1' })
    ).rejects.toBeInstanceOf(ServerError);
    await expect(
      executeBase.execute('select 1', [], [], { queryId: 'query-2' })
    ).rejects.toThrow('bad query');
    expect(connectionBase.releaseEntityManager).toHaveBeenCalledTimes(2);
  });
});
