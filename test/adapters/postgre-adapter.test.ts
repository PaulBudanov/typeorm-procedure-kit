import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { PostgresQueryRunner } from '../../src/typeorm/driver/postgres/PostgresQueryRunner.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

import type { FieldDef } from 'pg';

function createPostgreAdapter(): PostgreAdapter {
  return new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string => value,
      },
    }
  );
}

describe('PostgreAdapter', (): void => {
  it('generates safe package info SQL', (): void => {
    const adapter = createPostgreAdapter();

    const sql = adapter.generatePackageInfoSql('Public');

    expect(sql).toContain("proc.specific_schema = 'public'");
    expect(sql).toContain("proc.routine_type = 'PROCEDURE'");
    expect(sql).toContain('proc.specific_name AS "specific_name"');
    expect(sql).toContain("'__tpk_no_argument__'");
    expect(sql).toContain('LIMIT 10001');
    expect(sql).not.toContain(':PACKAGE_NAME');
    expect((): void => {
      adapter.generatePackageInfoSql('public;drop');
    }).toThrow(ServerError);
  });

  it('generates package info SQL from a custom template', (): void => {
    const adapter = createPostgreAdapter();

    expect(
      adapter.generatePackageInfoSql(
        'Public',
        'select * from custom_args where schema_name = :PACKAGE_NAME and owner = :PACKAGE_NAME'
      )
    ).toBe(
      "select * from custom_args where schema_name = 'public' and owner = 'public'"
    );
    expect((): void => {
      adapter.generatePackageInfoSql('public', 'select * from custom_args');
    }).toThrow(ServerError);
  });

  it('sorts procedure arguments and skips unrelated packages', (): void => {
    const adapter = createPostgreAdapter();

    expect(
      adapter.sortArgumentsAlgorithm(
        [
          {
            procedureName: 'Run',
            argumentName: 'P_SECOND',
            argumentType: 'varchar',
            order: 2,
            mode: 'IN',
          },
          {
            procedureName: 'Run',
            argumentName: 'P_FIRST',
            argumentType: 'int',
            order: 1,
            mode: 'IN',
          },
          {
            procedureName: 'Skip',
            argumentName: 'P_VALUE',
            argumentType: 'int',
            order: 1,
            mode: 'IN',
          },
        ],
        ['pkg.run'],
        'pkg',
        2
      )
    ).toEqual({
      run: [
        { argumentName: 'p_first', argumentType: 'int', order: 1, mode: 'IN' },
        {
          argumentName: 'p_second',
          argumentType: 'varchar',
          order: 2,
          mode: 'IN',
        },
      ],
    });
  });

  it('preserves all single-package routines and filters multi-package metadata', (): void => {
    const adapter = createPostgreAdapter();

    const procedures = adapter.sortArgumentsAlgorithm(
      [
        {
          procedureName: 'Ping',
          argumentName: '__tpk_no_argument__',
          argumentType: 'void',
          order: 0,
          mode: 'IN',
          specificName: 'ping_100',
        },
        {
          procedureName: 'Unlisted',
          argumentName: '__tpk_no_argument__',
          argumentType: 'void',
          order: 0,
          mode: 'IN',
          specificName: 'unlisted_101',
        },
      ],
      ['pkg.ping'],
      'pkg',
      1
    );
    expect(procedures).toEqual({ ping: [], unlisted: [] });
    expect(
      adapter.sortArgumentsAlgorithm(
        [
          {
            procedureName: 'Ping',
            argumentName: '__tpk_no_argument__',
            argumentType: 'void',
            order: 0,
            mode: 'IN',
            specificName: 'ping_100',
          },
          {
            procedureName: 'Unlisted',
            argumentName: '__tpk_no_argument__',
            argumentType: 'void',
            order: 0,
            mode: 'IN',
            specificName: 'unlisted_101',
          },
        ],
        ['pkg.ping'],
        'pkg',
        2
      )
    ).toEqual({ ping: [] });
    expect(adapter.makeBindings('pkg', 'ping', procedures)).toMatchObject({
      paramExecuteString: 'CALL "pkg"."ping"()',
      bindings: [],
      cursorsNames: [],
    });
    expect(() =>
      adapter.sortArgumentsAlgorithm(
        [
          {
            procedureName: 'Run',
            argumentName: 'value',
            argumentType: 'int4',
            order: 1,
            mode: 'IN',
            specificName: 'run_1',
          },
          {
            procedureName: 'Run',
            argumentName: 'value',
            argumentType: 'text',
            order: 1,
            mode: 'IN',
            specificName: 'run_2',
          },
        ],
        ['pkg.run'],
        'pkg',
        1
      )
    ).toThrow('is overloaded');
  });

  it('creates procedure bindings from object payloads and refcursors', (): void => {
    const adapter = createPostgreAdapter();

    const result = adapter.makeBindings(
      'pkg',
      'run',
      {
        run: [
          { argumentName: 'p_id', argumentType: 'int', order: 1, mode: 'IN' },
          {
            argumentName: 'items',
            argumentType: 'varchar',
            order: 2,
            mode: 'IN',
          },
          {
            argumentName: 'out_cursor',
            argumentType: 'refcursor',
            order: 3,
            mode: 'OUT',
          },
        ],
      },
      {
        id: 7,
        items: ['a', 'b'],
      }
    );
    expect(result).toMatchObject({
      paramExecuteString: 'CALL "pkg"."run"($1,$2,$3)',
      bindings: [7, 'a,b', null],
      cursorsNames: ['out_cursor'],
      outNames: ['out_cursor'],
      outBindings: [
        {
          name: 'out_cursor',
          type: 'cursor',
          databaseType: 'refcursor',
        },
      ],
    });
  });

  it('generates missing IN/OUT cursor names, preserves explicit names, and rejects unnamed portals', (): void => {
    const adapter = createPostgreAdapter();
    const procedures = {
      run: [
        {
          argumentName: 'in_cursor',
          argumentType: 'refcursor',
          order: 1,
          mode: 'IN' as const,
        },
        {
          argumentName: 'inout_cursor',
          argumentType: 'REFCURSOR',
          order: 2,
          mode: 'IN/OUT' as const,
        },
        {
          argumentName: 'out_cursor',
          argumentType: 'refcursor',
          order: 3,
          mode: 'OUT' as const,
        },
      ],
    };

    const generated = adapter.makeBindings('pkg', 'run', procedures);
    expect(generated.bindings).toEqual([
      expect.stringMatching(/^tpk_[0-9a-f_]+$/),
      expect.stringMatching(/^tpk_[0-9a-f_]+$/),
      null,
    ]);
    expect(generated.cursorsNames).toEqual(['inout_cursor', 'out_cursor']);

    expect(
      adapter.makeBindings('pkg', 'run', procedures, {
        in_cursor: 'input_portal',
        inout_cursor: 'portal"quoted',
      }).bindings
    ).toEqual(['input_portal', 'portal"quoted', null]);
    expect(
      (
        adapter.makeBindings('pkg', 'run', procedures, {
          inout_cursor: 'x'.repeat(63),
        }).bindings as Array<unknown>
      )[1]
    ).toBe('x'.repeat(63));
    expect(
      (
        adapter.makeBindings('pkg', 'run', procedures, {
          inout_cursor: `${'я'.repeat(31)}a`,
        }).bindings as Array<unknown>
      )[1]
    ).toBe(`${'я'.repeat(31)}a`);
    expect(() =>
      adapter.makeBindings('pkg', 'run', procedures, {
        inout_cursor: '<unnamed portal 1>',
      })
    ).toThrow('Unsafe PostgreSQL portal name');
    const oversizedPortal = `secret_${'x'.repeat(57)}`;
    try {
      adapter.makeBindings('pkg', 'run', procedures, {
        inout_cursor: oversizedPortal,
      });
      throw new Error('Expected oversized portal name to be rejected');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(
        'Unsafe PostgreSQL portal name'
      );
      expect((error as Error).message).not.toContain(oversizedPortal);
    }
    expect(() =>
      adapter.makeBindings('pkg', 'run', procedures, {
        inout_cursor: `${'я'.repeat(31)}ab`,
      })
    ).toThrow('Unsafe PostgreSQL portal name');
  });

  it('creates procedure bindings from array payloads and rejects scalar payloads', (): void => {
    const adapter = createPostgreAdapter();
    const procedures = {
      run: [
        {
          argumentName: 'p_id',
          argumentType: 'int',
          order: 1,
          mode: 'IN' as const,
        },
      ],
    };

    expect(
      adapter.makeBindings('pkg', 'run', procedures, [10]).bindings
    ).toEqual([10]);
    expect((): void => {
      adapter.makeBindings('pkg', 'run', procedures, 'bad' as never);
    }).toThrow(TypeError);
    expect((): void => {
      adapter.makeBindings('pkg', 'missing', procedures);
    }).toThrow(ServerError);
  });

  it('supports an explicitly named pure OUT portal and preserves metadata order', async (): Promise<void> => {
    const adapter = createPostgreAdapter();
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ out_status: 2, out_cursor: 'out_cursor' }])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([]);
    const manager = {
      query,
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    await expect(
      adapter.executeProcedure<{ id: number }>(
        'CALL "pkg"."run"($1,$2)',
        manager as never,
        [],
        [null, null],
        ['out_cursor'],
        [
          { name: 'out_status', type: 'scalar', databaseType: 'integer' },
          { name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' },
        ]
      )
    ).resolves.toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      outBinds: {
        out_status: 2,
        out_cursor: [{ id: 1 }, { id: 2 }],
      },
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      'FETCH FORWARD 1000 FROM "out_cursor"'
    );
    expect(query).toHaveBeenNthCalledWith(3, 'CLOSE "out_cursor"');
  });

  it('preserves a QueryRunner refcursor field through adapter FETCH and CLOSE', async (): Promise<void> => {
    const databaseQuery = vi.fn(async (sql: string) => {
      if (sql.startsWith('CALL')) {
        return {
          command: 'CALL',
          rowCount: 1,
          rows: [{ OUT_CURSOR: 'runner_portal' }],
          fields: [
            {
              name: 'OUT_CURSOR',
              dataTypeID: pgTypes.builtins.REFCURSOR,
            },
          ],
        };
      }
      if (sql.startsWith('FETCH')) {
        return {
          command: 'FETCH',
          rowCount: 1,
          rows: [{ ID: 7 }],
          fields: [{ name: 'ID', dataTypeID: pgTypes.builtins.INT4 }],
        };
      }
      return { command: 'CLOSE', rowCount: 0, rows: [], fields: [] };
    });
    const databaseConnection = {
      query: databaseQuery,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    let transformRows = (
      rows: Array<unknown>,
      _fields: Array<FieldDef>
    ): Array<unknown> => rows;
    const dataSource = {
      logger: {
        logQuery: vi.fn(),
        logQueryError: vi.fn(),
        logQuerySlow: vi.fn(),
      },
      subscribers: [],
      options: { replication: { master: {} } },
    };
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
      isReplicated: false,
      options: {},
      obtainMasterConnection: vi
        .fn()
        .mockResolvedValue([databaseConnection, vi.fn()]),
      configureResultHandling: vi.fn(
        (
          _typeOverrides: unknown,
          transformer: (
            rows: Array<unknown>,
            fields: Array<FieldDef>
          ) => Array<unknown>
        ): void => {
          transformRows = (rows, fields): Array<unknown> =>
            transformer(rows, fields);
        }
      ),
      transformResultRows: (
        rows: Array<unknown>,
        fields: Array<FieldDef>
      ): Array<unknown> => transformRows(rows, fields),
    };
    Object.assign(dataSource, { driver });
    const adapter = new PostgreAdapter(dataSource as never, createLogger(), {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string => value.toLowerCase(),
      },
    });
    adapter.registerFetchHandlerHook();
    const queryRunner = new PostgresQueryRunner(driver as never, 'master');
    const managerQuery = <T>(
      sql: string,
      bindings?: Array<unknown>
    ): Promise<T> => queryRunner.query<T>(sql, bindings);
    const transactionManager = { query: managerQuery };
    const manager = {
      query: managerQuery,
      transaction: async <T>(
        execute: (currentManager: unknown) => Promise<T>
      ): Promise<T> => execute(transactionManager),
    };

    await expect(
      adapter.executeProcedure<{ id: number }>(
        'CALL "pkg"."run"($1)',
        manager as never,
        [],
        [null],
        ['out_cursor'],
        [{ name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' }]
      )
    ).resolves.toEqual({
      rows: [{ id: 7 }],
      outBinds: { out_cursor: [{ id: 7 }] },
    });
    expect(databaseQuery).toHaveBeenNthCalledWith(
      2,
      'FETCH FORWARD 1000 FROM "runner_portal"',
      undefined
    );
    expect(databaseQuery).toHaveBeenNthCalledWith(
      3,
      'CLOSE "runner_portal"',
      undefined
    );
  });

  it('quotes returned portal names, closes after fetch failures, and rejects unnamed portals', async (): Promise<void> => {
    const logger = createLogger();
    const adapter = new PostgreAdapter(
      { options: { replication: { master: {} } } } as never,
      logger,
      {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy: {
          transformColumnName: (value: string): string => value,
        },
      }
    );
    const fetchError = new Error('fetch failed');
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ out_cursor: 'portal"safe' }])
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce([]);
    const manager = {
      query,
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    await expect(
      adapter.executeProcedure(
        'CALL "pkg"."run"($1)',
        manager as never,
        [],
        [null],
        ['out_cursor'],
        [{ name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' }]
      )
    ).rejects.toBe(fetchError);
    expect(query).toHaveBeenNthCalledWith(
      2,
      'FETCH FORWARD 1000 FROM "portal""safe"'
    );
    expect(query).toHaveBeenNthCalledWith(3, 'CLOSE "portal""safe"');

    const unnamedManager = {
      query: vi
        .fn()
        .mockResolvedValueOnce([{ out_cursor: '<unnamed portal 2>' }])
        .mockRejectedValueOnce(new Error('unnamed cleanup failed')),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(unnamedManager)
      ),
    };
    await expect(
      adapter.executeProcedure(
        'CALL "pkg"."run"($1)',
        unnamedManager as never,
        [],
        [null],
        ['out_cursor'],
        [{ name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' }]
      )
    ).rejects.toThrow(
      'refcursor outputs, including pure OUT, must return an explicit portal name'
    );
    expect(unnamedManager.query).toHaveBeenNthCalledWith(
      2,
      'CLOSE "<unnamed portal 2>"'
    );
    expect(unnamedManager.query).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to close pending PostgreSQL portal: unnamed cleanup failed'
    );

    const controlManager = {
      query: vi.fn().mockResolvedValue([{ out_cursor: 'portal\nname' }]),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(controlManager)
      ),
    };
    await expect(
      adapter.executeProcedure(
        'CALL "pkg"."run"($1)',
        controlManager as never,
        [],
        [null],
        ['out_cursor'],
        [{ name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' }]
      )
    ).rejects.toThrow('Unsafe PostgreSQL portal name');
    expect(controlManager.query).toHaveBeenCalledOnce();
  });

  it('rejects duplicate outputs and closes every safe portal on failures', async (): Promise<void> => {
    const adapter = createPostgreAdapter();
    const duplicateQuery = vi
      .fn()
      .mockResolvedValueOnce([
        { first_cursor: 'shared', second_cursor: 'shared' },
      ])
      .mockResolvedValueOnce([]);
    const duplicateManager = {
      query: duplicateQuery,
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(duplicateManager)
      ),
    };
    const cursorBindings = [
      {
        name: 'first_cursor',
        type: 'cursor' as const,
        databaseType: 'refcursor',
      },
      {
        name: 'second_cursor',
        type: 'cursor' as const,
        databaseType: 'refcursor',
      },
    ];

    await expect(
      adapter.executeProcedure(
        'CALL "pkg"."run"($1,$2)',
        duplicateManager as never,
        [],
        [null, null],
        ['first_cursor', 'second_cursor'],
        cursorBindings
      )
    ).rejects.toThrow('was returned for more than one cursor output');
    expect(duplicateQuery).toHaveBeenNthCalledWith(2, 'CLOSE "shared"');

    const fetchError = new Error('first fetch failed');
    const cleanupQuery = vi
      .fn()
      .mockResolvedValueOnce([
        { first_cursor: 'first_portal', second_cursor: 'second_portal' },
      ])
      .mockRejectedValueOnce(fetchError)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const cleanupManager = {
      query: cleanupQuery,
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(cleanupManager)
      ),
    };

    await expect(
      adapter.executeProcedure(
        'CALL "pkg"."run"($1,$2)',
        cleanupManager as never,
        [],
        [null, null],
        ['first_cursor', 'second_cursor'],
        cursorBindings
      )
    ).rejects.toBe(fetchError);
    expect(cleanupQuery).toHaveBeenNthCalledWith(
      2,
      'FETCH FORWARD 1000 FROM "first_portal"'
    );
    expect(cleanupQuery).toHaveBeenNthCalledWith(3, 'CLOSE "first_portal"');
    expect(cleanupQuery).toHaveBeenNthCalledWith(4, 'CLOSE "second_portal"');
    expect(cleanupQuery).toHaveBeenCalledTimes(4);
  });

  it('fetches refcursors in bounded batches and closes after a cumulative row limit error', async (): Promise<void> => {
    const adapter = new PostgreAdapter(
      { options: { replication: { master: {} } } } as never,
      createLogger(),
      {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy: {
          transformColumnName: (value: string): string => value,
        },
        resourceLimits: {
          maxProcedureRows: 1000,
          maxProcedureBytes: 1_000_000,
          maxMetadataRows: 1000,
          maxLobBytes: 100_000,
          maxNotificationQueue: 100,
          maxNotificationRows: 1000,
        },
      }
    );
    const firstBatch = Array.from({ length: 1000 }, (_, id) => ({ id }));
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ out_cursor: 'bounded_cursor' }])
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([{ id: 1000 }])
      .mockResolvedValueOnce([]);
    const manager = {
      query,
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    await expect(
      adapter.executeProcedure(
        'CALL "pkg"."run"($1)',
        manager as never,
        [],
        [null],
        ['out_cursor'],
        [{ name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' }]
      )
    ).rejects.toThrow('resourceLimits.maxProcedureRows (1000)');
    expect(query).toHaveBeenNthCalledWith(
      2,
      'FETCH FORWARD 1000 FROM "bounded_cursor"'
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      'FETCH FORWARD 1 FROM "bounded_cursor"'
    );
    expect(query).toHaveBeenNthCalledWith(4, 'CLOSE "bounded_cursor"');
  });

  it('counts scalar and cursor bytes cumulatively and closes after a byte limit error', async (): Promise<void> => {
    const adapter = new PostgreAdapter(
      { options: { replication: { master: {} } } } as never,
      createLogger(),
      {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy: {
          transformColumnName: (value: string): string => value,
        },
        resourceLimits: {
          maxProcedureRows: 100,
          maxProcedureBytes: 12,
          maxMetadataRows: 100,
          maxLobBytes: 12,
          maxNotificationQueue: 100,
          maxNotificationRows: 100,
        },
      }
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { out_status: '1234', out_cursor: 'bounded_cursor' },
      ])
      .mockResolvedValueOnce([{ value: '1234' }])
      .mockResolvedValueOnce([]);
    const manager = {
      query,
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    await expect(
      adapter.executeProcedure(
        'CALL "pkg"."run"($1,$2)',
        manager as never,
        [],
        ['1234', null],
        ['out_cursor'],
        [
          { name: 'out_status', type: 'scalar', databaseType: 'text' },
          { name: 'out_cursor', type: 'cursor', databaseType: 'refcursor' },
        ]
      )
    ).rejects.toThrow('resourceLimits.maxProcedureBytes (12)');
    expect(query).toHaveBeenNthCalledWith(
      2,
      'FETCH FORWARD 101 FROM "bounded_cursor"'
    );
    expect(query).toHaveBeenNthCalledWith(3, 'CLOSE "bounded_cursor"');
  });

  it('creates SQL bindings for uppercase named parameters', (): void => {
    const adapter = createPostgreAdapter();

    expect(
      adapter.makeSqlBindings('select * from users where id = :ID and x = :X', {
        id: 1,
      })
    ).toEqual({
      sqlString: 'select * from users where id = $1 and x = $2',
      bindings: [1, null],
    });
  });

  it('does not bind placeholders inside casts, literals, or comments', (): void => {
    const adapter = createPostgreAdapter();

    expect(
      adapter.makeSqlBindings(
        "select :ID::uuid, ':SKIP', /* :SKIP */ -- :SKIP\nwhere x = :X",
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          skip: 'ignored',
          x: 1,
        }
      )
    ).toEqual({
      sqlString: "select $1::uuid, ':SKIP', /* :SKIP */ -- :SKIP\nwhere x = $2",
      bindings: ['550e8400-e29b-41d4-a716-446655440000', 1],
    });
  });
});
