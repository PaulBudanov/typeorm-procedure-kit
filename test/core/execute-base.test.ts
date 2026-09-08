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

  it('returns the procedure result envelope and releases the manager', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const procedureResult = {
      rows: [{ id: 1 }],
      outBinds: { outCursor: [{ id: 1 }], status: 2 },
    };
    const adapter = createAdapterMock({
      executeProcedure: vi.fn().mockResolvedValue(procedureResult),
    });
    const executeBase = new ExecuteBase(
      connectionBase as never,
      adapter,
      createLogger()
    );
    const outBindings = [
      {
        name: 'out_cursor',
        type: 'cursor' as const,
        databaseType: 'REF CURSOR',
      },
      { name: 'status', type: 'scalar' as const, databaseType: 'NUMBER' },
    ];

    await expect(
      executeBase.executeProcedure(
        'begin pkg.run(:out_cursor, :status); end;',
        {},
        ['out_cursor'],
        outBindings,
        { queryId: 'procedure-1' }
      )
    ).resolves.toEqual(procedureResult);
    expect(adapter.executeProcedure).toHaveBeenCalledWith(
      'begin pkg.run(:out_cursor, :status); end;',
      manager,
      [],
      {},
      ['out_cursor'],
      outBindings
    );
    expect(connectionBase.releaseEntityManager).toHaveBeenCalledWith(manager);
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

  it('surfaces release failure after a successful operation', async (): Promise<void> => {
    const manager = {};
    const releaseError = new Error('release failed');
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockRejectedValue(releaseError),
    };
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        execute: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
      createLogger()
    );

    await expect(executeBase.execute('select 1')).rejects.toBe(releaseError);
  });

  it('preserves operation and release failures in an AggregateError', async (): Promise<void> => {
    const manager = {};
    const operationError = new Error('query failed');
    const releaseError = new Error('release failed');
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockRejectedValue(releaseError),
    };
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        execute: vi.fn().mockRejectedValue(operationError),
      }),
      createLogger()
    );

    const result = executeBase.execute('select 1', [], [], {
      queryId: 'query-aggregate',
    });

    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'query failed' }),
        releaseError,
      ],
      cause: expect.objectContaining({ message: 'query failed' }),
    });
  });
});
