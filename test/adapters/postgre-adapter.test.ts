import { describe, expect, it } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

function createPostgreAdapter(): PostgreAdapter {
  return new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseNativeStrategy: {
        transformColumnName: (value: string): string => value,
      },
    }
  );
}

describe('PostgreAdapter', (): void => {
  it('generates safe package info SQL', (): void => {
    const adapter = createPostgreAdapter();

    expect(adapter.generatePackageInfoSql('public')).toContain("'public';");
    expect((): void => {
      adapter.generatePackageInfoSql('public;drop');
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
    });
  });

  it('creates procedure bindings from array payloads and rejects scalar payloads', (): void => {
    const adapter = createPostgreAdapter();
    const procedures = {
      run: [
        { argumentName: 'p_id', argumentType: 'int', order: 1, mode: 'IN' },
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
});
