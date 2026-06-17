import { Readable } from 'stream';

import { describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

function createOracleAdapter(): OracleAdapter {
  return new OracleAdapter(
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
    expect(result.bindings).toMatchObject([{ val: 7 }, { val: 'a,b' }, {}]);
  });

  it('rejects missing procedures, scalar payloads, and unsafe bind names', (): void => {
    const adapter = createOracleAdapter();
    const procedures = {
      run: [
        { argumentName: 'p_id', argumentType: 'NUMBER', order: 1, mode: 'IN' },
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

    await adapter.execute('select 1 from dual', manager as never, [], [], []);

    expect(manager.queryRunner.connect).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledWith('select 1 from dual', []);
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
          events.push(`${cursorName}:close`);
        },
      };
    };
    const manager = {
      connection: { options: { type: 'oracle' } },
      query: vi
        .fn()
        .mockResolvedValue([
          createResultSet('first'),
          createResultSet('second'),
        ]),
      transaction: vi.fn(
        async (execute: (transactionManager: unknown) => Promise<unknown>) => {
          return execute(manager);
        }
      ),
    };

    await expect(
      adapter.execute<{ cursorName: string }>(
        'begin pkg.run(:first, :second); end;',
        manager as never,
        [],
        [],
        ['first', 'second']
      )
    ).resolves.toEqual([{ cursorName: 'first' }, { cursorName: 'second' }]);
    expect(maxActiveStreams).toBe(1);
    expect(events).toEqual([
      'first:start',
      'first:end',
      'first:close',
      'second:start',
      'second:end',
      'second:close',
    ]);
  });
});
