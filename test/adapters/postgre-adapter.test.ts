import { describe, expect, it, vi } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

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

  it('creates procedure bindings from object payloads and refcursors', (): void => {
    const adapter = createPostgreAdapter();

    expect(
      adapter.makeBindings(
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
      )
    ).toEqual({
      paramExecuteString: 'CALL "pkg"."run"($1,$2,$3)',
      bindings: [7, 'a,b', 'out_cursor'],
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

  it('preserves PostgreSQL scalar and cursor out binds in metadata order', async (): Promise<void> => {
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
        [null, 'out_cursor'],
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
    expect(query).toHaveBeenNthCalledWith(2, 'FETCH ALL IN "out_cursor"');
    expect(query).toHaveBeenNthCalledWith(3, 'CLOSE "out_cursor"');
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
