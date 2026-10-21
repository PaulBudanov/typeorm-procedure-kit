import { AsyncResource } from 'node:async_hooks';

import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgreSerializer } from '../../src/adapters/postgres/postgre-serializer.js';
import { ExecuteBase } from '../../src/core/execute-base.js';
import { ProcedureListBase } from '../../src/core/procedure-list-base.js';
import { isInKitCall } from '../../src/utils/kit-call-context.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

import type { FieldDef } from 'pg';

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

  it.each(['rows', 'outBinds'] as const)(
    'logs a procedure %s error only through the binding-safe timer',
    async (location): Promise<void> => {
      const manager = {};
      const connectionBase = {
        getEntityManager: vi.fn().mockResolvedValue(manager),
        releaseEntityManager: vi.fn().mockResolvedValue(undefined),
      };
      const logger = createLogger();
      const secret = 'FAKE_SECRET_SENTINEL';
      const envelope = { error_code: 1, error_text: `Rejected ${secret}` };
      const executeBase = new ExecuteBase(
        connectionBase as never,
        createAdapterMock({
          executeProcedure: vi.fn().mockResolvedValue({
            rows: location === 'rows' ? [envelope] : [],
            outBinds: location === 'outBinds' ? envelope : {},
          }),
        }),
        logger
      );

      await expect(
        executeBase.executeProcedure('CALL example', [secret], [], [], {
          queryId: 'private-query',
        })
      ).rejects.toMatchObject({
        errorId: 'private-query',
        message: `Database error: Rejected ${secret}`,
      });
      expect(logger.error).toHaveBeenCalledOnce();
      for (const method of [logger.log, logger.warn, logger.error]) {
        expect(JSON.stringify(method.mock.calls)).not.toContain(secret);
      }
      expect(connectionBase.releaseEntityManager).toHaveBeenCalledWith(manager);
    }
  );

  it('preserves the query id for a raw SQL error envelope', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        execute: vi
          .fn()
          .mockResolvedValue([{ error_code: 1, error_text: 'raw failure' }]),
      }),
      logger
    );

    await expect(
      executeBase.execute('select example', [], [], { queryId: 'raw-query' })
    ).rejects.toMatchObject({ errorId: 'raw-query' });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(connectionBase.releaseEntityManager).toHaveBeenCalledWith(manager);
  });

  it('logs the query start only after a connection is acquired', async (): Promise<void> => {
    const poolError = new Error('pool exhausted');
    const connectionBase = {
      getEntityManager: vi.fn().mockRejectedValue(poolError),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({ execute: vi.fn() }),
      logger
    );

    await expect(
      executeBase.execute('select 1', [], [], { queryId: 'pool-query' })
    ).rejects.toThrow('pool exhausted');

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls.at(-1)?.[0]).toEqual(
      expect.stringContaining('SQL request [pool-query] failed')
    );
    expect(connectionBase.releaseEntityManager).not.toHaveBeenCalled();
  });

  it('logs the query start once the connection is in hand', async (): Promise<void> => {
    const manager = {};
    const acquisitionOrder: Array<string> = [];
    const logger = createLogger();
    logger.log.mockImplementation((message: unknown): void => {
      if (typeof message === 'string' && message.includes('started')) {
        acquisitionOrder.push('started');
      }
    });
    const connectionBase = {
      getEntityManager: vi
        .fn()
        .mockImplementation(async (): Promise<object> => {
          acquisitionOrder.push('acquired');
          return manager;
        }),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({ execute: vi.fn().mockResolvedValue([{ id: 1 }]) }),
      logger
    );

    await executeBase.execute('select 1', [], [], { queryId: 'ordered-query' });

    expect(acquisitionOrder).toEqual(['acquired', 'started']);
  });

  it('throws for a multi-row result whose first row is an error envelope', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        execute: vi
          .fn()
          .mockResolvedValue([
            { error_code: 1, error_text: 'raw failure' },
            { id: 2 },
          ]),
      }),
      createLogger()
    );

    await expect(
      executeBase.execute('select example', [], [], { queryId: 'multi-row' })
    ).rejects.toMatchObject({
      errorId: 'multi-row',
      message: 'Database error: raw failure',
    });
    expect(connectionBase.releaseEntityManager).toHaveBeenCalledWith(manager);
  });

  it('returns rows untouched when execution options empty the envelope keys', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const auditRows = [{ error_code: 500, error_text: 'audited failure' }];
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        execute: vi.fn().mockResolvedValue(auditRows),
      }),
      createLogger()
    );

    await expect(
      executeBase.execute('select error_code, error_text from audit', [], [], {
        queryId: 'audit-query',
        errorEnvelopeKeys: { errorCodeKeys: [] },
      })
    ).resolves.toEqual(auditRows);
  });

  it('applies execution-level envelope keys to procedure rows and out binds', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        executeProcedure: vi.fn().mockResolvedValue({
          rows: [],
          outBinds: { status_code: 7, status_text: 'configured failure' },
        }),
      }),
      createLogger()
    );

    await expect(
      executeBase.executeProcedure('CALL example', [], [], [], {
        queryId: 'configured-procedure',
        errorEnvelopeKeys: {
          errorCodeKeys: ['status_code'],
          errorTextKeys: ['status_text'],
        },
      })
    ).rejects.toMatchObject({
      errorId: 'configured-procedure',
      message: 'Database error: configured failure',
    });
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

  it('logs the returned row count for a rowset result', async (): Promise<void> => {
    const manager = {};
    const connectionBase = {
      getEntityManager: vi.fn().mockResolvedValue(manager),
      releaseEntityManager: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        execute: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      }),
      logger
    );

    await executeBase.execute('select 1', [], [], { queryId: 'rowset-query' });

    expect(logger.log.mock.calls.at(-1)?.[0]).toEqual(
      expect.stringContaining('with 2 rows')
    );
  });

  it.each([
    ['a string status', 'DONE'],
    ['an empty result', null],
  ])(
    'omits the row count when the statement returns %s',
    async (_label, adapterResult): Promise<void> => {
      const manager = {};
      const connectionBase = {
        getEntityManager: vi.fn().mockResolvedValue(manager),
        releaseEntityManager: vi.fn().mockResolvedValue(undefined),
      };
      const logger = createLogger();
      const executeBase = new ExecuteBase(
        connectionBase as never,
        createAdapterMock({
          execute: vi.fn().mockResolvedValue(adapterResult),
        }),
        logger
      );

      await executeBase.execute('update example set id = 1', [], [], {
        queryId: 'plain-statement',
      });

      const successMessage = logger.log.mock.calls.at(-1)?.[0];
      expect(successMessage).toEqual(
        expect.stringContaining('completed successfully')
      );
      expect(successMessage).not.toEqual(expect.stringContaining(' rows'));
      expect(logger.error).not.toHaveBeenCalled();
      expect(connectionBase.releaseEntityManager).toHaveBeenCalledWith(manager);
    }
  );

  it.each(['execute', 'executeProcedure'] as const)(
    'runs the adapter %s call inside a kit call',
    async (method): Promise<void> => {
      const observed: Array<boolean> = [];
      const record = async (): Promise<unknown> => {
        observed.push(isInKitCall());
        await Promise.resolve();
        observed.push(isInKitCall());
        return method === 'execute' ? [] : { rows: [], outBinds: {} };
      };
      const executeBase = new ExecuteBase(
        {
          getEntityManager: vi.fn().mockResolvedValue({}),
          releaseEntityManager: vi.fn().mockResolvedValue(undefined),
        } as never,
        createAdapterMock({
          execute: vi.fn().mockImplementation(record),
          executeProcedure: vi.fn().mockImplementation(record),
        }),
        createLogger()
      );

      await (method === 'execute'
        ? executeBase.execute('select 1')
        : executeBase.executeProcedure('CALL example'));

      expect(observed).toEqual([true, true]);
      expect(isInKitCall()).toBe(false);
    }
  );

  it('takes and releases the connection outside the kit call', async (): Promise<void> => {
    // A pooled socket keeps the asynchronous context it was opened in, and node-postgres hands
    // streamed rows over in that context. A socket opened inside the kit call would carry the
    // mark into every later query on the same connection, raw ones included.
    const manager = {};
    let pooledSocket: AsyncResource | undefined;
    const observed: Record<string, boolean> = {};
    const connectionBase = {
      getEntityManager: vi.fn(async (): Promise<object> => {
        observed.acquire = isInKitCall();
        pooledSocket = new AsyncResource('PooledSocket');
        return manager;
      }),
      releaseEntityManager: vi.fn(async (): Promise<void> => {
        observed.release = isInKitCall();
      }),
    };
    const executeBase = new ExecuteBase(
      connectionBase as never,
      createAdapterMock({
        execute: vi
          .fn()
          .mockImplementation(async (): Promise<Array<unknown>> => {
            observed.operation = isInKitCall();
            observed.socketDuringCall =
              pooledSocket?.runInAsyncScope((): boolean => isInKitCall()) ??
              true;
            return [];
          }),
      }),
      createLogger()
    );

    await executeBase.execute('select 1');

    expect(observed).toEqual({
      acquire: false,
      operation: true,
      socketDuringCall: false,
      release: false,
    });
    expect(pooledSocket?.runInAsyncScope((): boolean => isInKitCall())).toBe(
      false
    );
  });

  it('checks the kit metadata query strictly, as part of a kit call', async (): Promise<void> => {
    // Nothing in ProcedureListBase marks the query: it is strict because it runs through
    // ExecuteBase, as `call()` and `callSqlTransaction()` do.
    const serializer = new PostgreSerializer(createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string => value.toLowerCase(),
      },
    });
    const metadataFields = [
      { name: 'procedure_name', dataTypeID: pgTypes.builtins.TEXT },
      { name: 'PROCEDURE_NAME', dataTypeID: pgTypes.builtins.TEXT },
    ] as Array<FieldDef>;
    const adapter = createAdapterMock({
      generatePackageInfoSql: vi.fn((): string => 'select metadata'),
      execute: vi
        .fn()
        .mockImplementation(
          async (): Promise<Array<unknown>> =>
            serializer.transformRows(
              [{ procedure_name: 'run', PROCEDURE_NAME: 'RUN' }],
              metadataFields
            )
        ),
    });
    const logger = createLogger();
    const procedureList = new ProcedureListBase(
      logger,
      adapter,
      new ExecuteBase(
        {
          getEntityManager: vi.fn().mockResolvedValue({}),
          releaseEntityManager: vi.fn().mockResolvedValue(undefined),
        } as never,
        adapter,
        logger
      ),
      { packages: ['pkg'], procedureObjectList: { run: 'pkg.run' } }
    );

    try {
      await expect(
        procedureList.fetchProcedureListWithArguments('pkg')
      ).rejects.toThrow(
        'Failed to fetch procedure list with arguments for package pkg: PostgreSQL result columns "procedure_name" and "PROCEDURE_NAME" have conflicting transformed name "procedure_name"'
      );
    } finally {
      await procedureList.destroy();
    }
  });
});
