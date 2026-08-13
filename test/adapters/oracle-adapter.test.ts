import { Readable } from 'stream';

import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

function createOracleAdapter(registerDefaults = false): OracleAdapter {
  return new OracleAdapter(
    {
      options: { replication: { master: {} } },
      driver: { setFetchTypeHandler: vi.fn() },
    } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: registerDefaults,
      caseStrategy: {
        transformColumnName: (value: string): string => value.toLowerCase(),
      },
    }
  );
}

describe('OracleAdapter', (): void => {
  it('generates safe package info SQL', (): void => {
    const adapter = createOracleAdapter();

    const sql = adapter.generatePackageInfoSql('pkg');

    expect(sql).toContain("a.PACKAGE_NAME = 'PKG'");
    expect(sql).not.toContain(':PACKAGE_NAME');
    expect(sql).not.toContain('package_name');
    expect((): void => {
      adapter.generatePackageInfoSql('pkg;drop');
    }).toThrow(ServerError);
  });

  it('generates package info SQL from a custom template', (): void => {
    const adapter = createOracleAdapter();

    expect(
      adapter.generatePackageInfoSql(
        'pkg',
        'SELECT * FROM CUSTOM_ARGS WHERE PACKAGE_NAME = :PACKAGE_NAME'
      )
    ).toBe("SELECT * FROM CUSTOM_ARGS WHERE PACKAGE_NAME = 'PKG'");
    expect((): void => {
      adapter.generatePackageInfoSql('pkg', 'SELECT * FROM CUSTOM_ARGS');
    }).toThrow(ServerError);
  });

  it('creates PL/SQL call bindings from object payloads', (): void => {
    const adapter = createOracleAdapter();
    const result = adapter.makeBindings(
      'pkg',
      'run',
      {
        run: [
          {
            argumentName: 'p_id',
            argumentType: 'NUMBER',
            order: 1,
            mode: 'IN',
          },
          {
            argumentName: 'p_names',
            argumentType: 'VARCHAR2',
            order: 2,
            mode: 'IN',
          },
          {
            argumentName: 'out_cursor',
            argumentType: 'REF CURSOR',
            order: 3,
            mode: 'OUT',
          },
        ],
      },
      {
        id: 7,
        names: ['a', 'b'],
      }
    );

    expect(result.paramExecuteString).toBe(
      'BEGIN PKG.RUN (:p_id,:p_names,:out_cursor); END;'
    );
    expect(result.cursorsNames).toEqual(['out_cursor']);
    expect(result.outBindings).toEqual([
      {
        name: 'out_cursor',
        type: 'cursor',
        databaseType: 'REF CURSOR',
      },
    ]);
    expect(result.bindings).toMatchObject({
      p_id: { val: 7 },
      p_names: { val: 'a,b' },
      out_cursor: {},
    });
  });

  it('rejects missing procedures, scalar payloads, and unsafe bind names', (): void => {
    const adapter = createOracleAdapter();
    const procedures = {
      run: [
        {
          argumentName: 'p_id',
          argumentType: 'NUMBER',
          order: 1,
          mode: 'IN' as const,
        },
      ],
    };

    expect((): void => {
      adapter.makeBindings('pkg', 'missing', procedures);
    }).toThrow(ServerError);
    expect((): void => {
      adapter.makeBindings('pkg', 'run', procedures, 1 as never);
    }).toThrow(TypeError);
    expect((): void => {
      adapter.makeBindings('pkg', 'run', {
        run: [
          {
            argumentName: 'p_id;drop',
            argumentType: 'NUMBER',
            order: 1,
            mode: 'IN',
          },
        ],
      });
    }).toThrow(ServerError);
  });

  it('uses exact Oracle temporal bind types and validates temporal inputs', (): void => {
    const adapter = createOracleAdapter();
    const result = adapter.makeBindings(
      'pkg',
      'run',
      {
        run: [
          {
            argumentName: 'p_date',
            argumentType: 'DATE',
            order: 1,
            mode: 'IN',
          },
          {
            argumentName: 'p_timestamp',
            argumentType: 'TIMESTAMP',
            order: 2,
            mode: 'IN',
          },
          {
            argumentName: 'p_tstz',
            argumentType: 'TIMESTAMP WITH TIME ZONE',
            order: 3,
            mode: 'IN',
          },
          {
            argumentName: 'p_tsltz',
            argumentType: 'TIMESTAMP WITH LOCAL TIME ZONE',
            order: 4,
            mode: 'IN',
          },
        ],
      },
      {
        date: '2026-07-16 12:30:00',
        timestamp: new Date('2026-07-16T12:30:00.123Z'),
        tstz: '2026-07-16 12:30:00 +03:00',
        tsltz: '2026-07-16 12:30:00 +03:00',
      }
    );

    const bindings = result.bindings as Record<
      string,
      { type: unknown; val: unknown }
    >;
    expect(bindings.p_date!.type).toBe(oracledb.DB_TYPE_DATE);
    expect(bindings.p_timestamp!.type).toBe(oracledb.DB_TYPE_TIMESTAMP);
    expect(bindings.p_tstz!.type).toBe(oracledb.DB_TYPE_TIMESTAMP_TZ);
    expect(bindings.p_tsltz!.type).toBe(oracledb.DB_TYPE_TIMESTAMP_LTZ);
    expect(bindings.p_date!.val).toBeInstanceOf(Date);
    expect(() =>
      adapter.makeBindings(
        'pkg',
        'run',
        {
          run: [
            {
              argumentName: 'p_tstz',
              argumentType: 'TIMESTAMP WITH TIME ZONE',
              order: 1,
              mode: 'IN',
            },
          ],
        },
        { tstz: '2026-07-16 12:30:00' }
      )
    ).toThrow(ServerError);
    expect(() =>
      adapter.makeBindings(
        'pkg',
        'run',
        {
          run: [
            {
              argumentName: 'p_date',
              argumentType: 'DATE',
              order: 1,
              mode: 'IN',
            },
          ],
        },
        { date: ['2026-07-16 12:30:00'] }
      )
    ).toThrow(ServerError);
  });

  it('allocates metadata-aware OUT and IN/OUT buffers above 200 bytes', (): void => {
    const adapter = createOracleAdapter();
    const procedures = adapter.sortArgumentsAlgorithm(
      [
        {
          procedureName: 'RUN',
          argumentName: 'OUT_TEXT',
          argumentType: 'VARCHAR2',
          order: 1,
          mode: 'OUT',
          size: 512,
        },
        {
          procedureName: 'RUN',
          argumentName: 'P_RAW',
          argumentType: 'RAW',
          order: 2,
          mode: 'IN/OUT',
        },
      ],
      ['pkg.run'],
      'pkg',
      1
    );
    expect(procedures.run?.[0]).toMatchObject({ size: 512 });

    const result = adapter.makeBindings('pkg', 'run', procedures, {
      raw: Buffer.from('input'),
    });
    const bindings = result.bindings as Record<
      string,
      { type: unknown; val?: unknown; maxSize?: number }
    >;

    expect(bindings.out_text).toMatchObject({
      type: oracledb.STRING,
      maxSize: 512,
    });
    expect(bindings.p_raw).toMatchObject({
      type: oracledb.BUFFER,
      val: Buffer.from('input'),
      maxSize: 32_767,
    });
    expect(bindings.out_text!.maxSize).toBeGreaterThan(200);
    expect(bindings.p_raw!.maxSize).toBeGreaterThan(200);
  });

  it('rejects persistent Oracle TIME_ZONE overrides in optionsCommands', async (): Promise<void> => {
    const adapter = createOracleAdapter();
    const manager = {
      transaction: vi.fn(),
      query: vi.fn(),
    };

    await expect(
      adapter.execute('select 1 from dual', manager as never, [
        "/* audit */ ALTER SESSION SET TIME_ZONE = '+03:00'",
      ])
    ).rejects.toThrow('Configure sessionTimeZone instead');
    await expect(
      adapter.executeProcedure('begin pkg.run; end;', manager as never, [
        "-- audit\nALTER SESSION SET TIME_ZONE = 'UTC'",
      ])
    ).rejects.toThrow('Configure sessionTimeZone instead');
    expect(manager.transaction).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('preserves scalar-only Oracle out binds in the result envelope', async (): Promise<void> => {
    const adapter = createOracleAdapter();
    const outDate = new Date('2026-07-16T12:30:00.000Z');
    const manager = {
      query: vi.fn().mockResolvedValue({ out_date: outDate, out_count: 2 }),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    await expect(
      adapter.executeProcedure(
        'begin pkg.run(:out_date, :out_count); end;',
        manager as never,
        [],
        {},
        [],
        [
          { name: 'out_date', type: 'scalar', databaseType: 'DATE' },
          { name: 'out_count', type: 'scalar', databaseType: 'NUMBER' },
        ]
      )
    ).resolves.toEqual({
      rows: [],
      outBinds: { out_date: outDate, out_count: 2 },
    });
  });

  it('keeps Oracle named parameters and returns bindings in occurrence order', (): void => {
    const adapter = createOracleAdapter();

    expect(
      adapter.makeSqlBindings('select * from users where id = :ID and x = :X', {
        id: 1,
      })
    ).toEqual({
      sqlString: 'select * from users where id = :ID and x = :X',
      bindings: [1, null],
    });
  });

  it('does not collect placeholders inside literals or comments', (): void => {
    const adapter = createOracleAdapter();
    const sql =
      "select :ID, ':SKIP' from dual /* :SKIP */ -- :SKIP\nwhere x = :X";

    expect(
      adapter.makeSqlBindings(sql, {
        id: 1,
        skip: 'ignored',
        x: 2,
      })
    ).toEqual({
      sqlString: sql,
      bindings: [1, 2],
    });
  });

  it('does not obtain the Oracle physical connection from adapter runtime', async (): Promise<void> => {
    const adapter = createOracleAdapter();
    const bindings = { p_id: { val: 1 } };
    const manager = {
      connection: { options: { type: 'oracle' } },
      queryRunner: {
        connect: vi.fn(),
      },
      query: vi.fn().mockResolvedValue([]),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) => {
          return execute(manager);
        }
      ),
    };

    await adapter.execute(
      'begin pkg.run(:p_id); end;',
      manager as never,
      [],
      bindings,
      []
    );

    expect(manager.queryRunner.connect).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledWith(
      'begin pkg.run(:p_id); end;',
      bindings
    );
  });

  it('drains Oracle cursor streams sequentially on the shared connection', async (): Promise<void> => {
    const adapter = createOracleAdapter();
    let activeStreams = 0;
    let maxActiveStreams = 0;
    const events: Array<string> = [];
    const createResultSet = (
      cursorName: string
    ): { toQueryStream: () => Readable; close: () => Promise<void> } => {
      return {
        toQueryStream: (): Readable => {
          return Readable.from(
            (async function* (): AsyncGenerator<{ cursorName: string }> {
              activeStreams += 1;
              maxActiveStreams = Math.max(maxActiveStreams, activeStreams);
              events.push(`${cursorName}:start`);
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              yield { cursorName };
              activeStreams -= 1;
              events.push(`${cursorName}:end`);
            })()
          );
        },
        close: async (): Promise<void> => {
          throw new Error(
            `ResultSet.close must not be called after streaming ${cursorName}`
          );
        },
      };
    };
    const manager = {
      connection: { options: { type: 'oracle' } },
      query: vi.fn().mockResolvedValue({
        status: 1,
        first: createResultSet('first'),
        second: createResultSet('second'),
      }),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) => {
          return execute(manager);
        }
      ),
    };

    await expect(
      adapter.executeProcedure<{ cursorName: string }>(
        'begin pkg.run(:first, :second); end;',
        manager as never,
        [],
        [],
        ['first', 'second'],
        [
          { name: 'first', type: 'cursor', databaseType: 'REF CURSOR' },
          { name: 'second', type: 'cursor', databaseType: 'REF CURSOR' },
        ]
      )
    ).resolves.toEqual({
      rows: [{ cursorName: 'first' }, { cursorName: 'second' }],
      outBinds: {
        first: [{ cursorName: 'first' }],
        second: [{ cursorName: 'second' }],
      },
    });
    expect(maxActiveStreams).toBe(1);
    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('applies case and temporal serializers to REF CURSOR rows using metadata', async (): Promise<void> => {
    const adapter = createOracleAdapter(true);
    adapter.registerFetchHandlerHook();
    const localDate = new Date(2026, 6, 16, 12, 30, 45, 123);
    const absoluteDate = new Date('2026-07-16T09:30:45.123Z');
    const resultSet = {
      metaData: [
        { name: 'DATE_VALUE', dbType: oracledb.DB_TYPE_DATE },
        { name: 'TIMESTAMP_VALUE', dbType: oracledb.DB_TYPE_TIMESTAMP },
        { name: 'TSTZ_VALUE', dbType: oracledb.DB_TYPE_TIMESTAMP_TZ },
        { name: 'TSLTZ_VALUE', dbType: oracledb.DB_TYPE_TIMESTAMP_LTZ },
      ],
      toQueryStream: (): Readable =>
        Readable.from([
          {
            DATE_VALUE: localDate,
            TIMESTAMP_VALUE: localDate,
            TSTZ_VALUE: absoluteDate,
            TSLTZ_VALUE: absoluteDate,
          },
        ]),
      close: vi.fn(),
    };
    const manager = {
      query: vi.fn().mockResolvedValue({ OUT_CURSOR: resultSet }),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    await expect(
      adapter.executeProcedure(
        'begin pkg.run(:out_cursor); end;',
        manager as never,
        [],
        {},
        ['out_cursor'],
        [{ name: 'out_cursor', type: 'cursor', databaseType: 'REF CURSOR' }]
      )
    ).resolves.toEqual({
      rows: [
        {
          date_value: '2026-07-16 12:30:45',
          timestamp_value: '2026-07-16 12:30:45.123',
          tstz_value: '2026-07-16T09:30:45.123Z',
          tsltz_value: '2026-07-16T09:30:45.123Z',
        },
      ],
      outBinds: {
        out_cursor: [
          {
            date_value: '2026-07-16 12:30:45',
            timestamp_value: '2026-07-16 12:30:45.123',
            tstz_value: '2026-07-16T09:30:45.123Z',
            tsltz_value: '2026-07-16T09:30:45.123Z',
          },
        ],
      },
    });
  });

  it('rejects cursor-like values without a close method', async (): Promise<void> => {
    const adapter = createOracleAdapter();
    const manager = {
      query: vi.fn().mockResolvedValue({
        out_cursor: {
          toQueryStream: (): Readable => Readable.from([{ id: 1 }]),
        },
      }),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    await expect(
      adapter.executeProcedure(
        'begin pkg.run(:out_cursor); end;',
        manager as never,
        [],
        {},
        ['out_cursor'],
        [{ name: 'out_cursor', type: 'cursor', databaseType: 'REF CURSOR' }]
      )
    ).rejects.toThrow('Oracle cursor "out_cursor" was not returned');
  });

  it('closes unstreamed Oracle result sets after cursor stream setup errors', async (): Promise<void> => {
    const adapter = createOracleAdapter();
    const events: Array<string> = [];
    const createResultSet = (
      cursorName: string,
      options: { failStream?: boolean } = {}
    ): { toQueryStream: () => Readable; close: () => Promise<void> } => {
      return {
        toQueryStream: (): Readable => {
          if (options.failStream) {
            events.push(`${cursorName}:stream-error`);
            throw new Error(`${cursorName} stream failed`);
          }
          return Readable.from(
            (async function* (): AsyncGenerator<{ cursorName: string }> {
              events.push(`${cursorName}:start`);
              yield { cursorName };
              events.push(`${cursorName}:end`);
            })()
          );
        },
        close: async (): Promise<void> => {
          events.push(`${cursorName}:close`);
        },
      };
    };
    const manager = {
      connection: { options: { type: 'oracle' } },
      query: vi.fn().mockResolvedValue({
        first: createResultSet('first'),
        second: createResultSet('second', { failStream: true }),
        third: createResultSet('third'),
      }),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) => {
          return execute(manager);
        }
      ),
    };

    await expect(
      adapter.executeProcedure<{ cursorName: string }>(
        'begin pkg.run(:first, :second, :third); end;',
        manager as never,
        [],
        [],
        ['first', 'second', 'third'],
        [
          { name: 'first', type: 'cursor', databaseType: 'REF CURSOR' },
          { name: 'second', type: 'cursor', databaseType: 'REF CURSOR' },
          { name: 'third', type: 'cursor', databaseType: 'REF CURSOR' },
        ]
      )
    ).rejects.toThrow('second stream failed');
    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:stream-error',
      'second:close',
      'third:close',
    ]);
  });

  it('flattens a 200k-row Oracle cursor without argument spreading', async (): Promise<void> => {
    const adapter = createOracleAdapter();
    const resultSet = {
      toQueryStream: (): Readable =>
        Readable.from(
          (function* (): Generator<number> {
            for (let index = 0; index < 200_000; index += 1) yield index;
          })()
        ),
      close: vi.fn(),
    };
    const manager = {
      query: vi.fn().mockResolvedValue({ out_cursor: resultSet }),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) =>
          execute(manager)
      ),
    };

    const result = await adapter.executeProcedure<number>(
      'begin pkg.run(:out_cursor); end;',
      manager as never,
      [],
      {},
      ['out_cursor'],
      [{ name: 'out_cursor', type: 'cursor', databaseType: 'REF CURSOR' }]
    );

    expect(result.rows).toHaveLength(200_000);
    expect(
      (result.outBinds as Record<string, Array<number>>).out_cursor
    ).toHaveLength(200_000);
  });
});
