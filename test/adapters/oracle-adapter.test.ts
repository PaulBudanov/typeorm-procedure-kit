import { describe, expect, it } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

function createOracleAdapter(): OracleAdapter {
  return new OracleAdapter(
    { options: { replication: { master: {} } } } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseNativeStrategy: {
        transformColumnName: (value: string): string => value,
      },
    },
    {}
  );
}

describe('OracleAdapter', (): void => {
  it('generates safe package info SQL', (): void => {
    const adapter = createOracleAdapter();

    expect(adapter.generatePackageInfoSql('pkg')).toContain("('PKG')");
    expect((): void => {
      adapter.generatePackageInfoSql('pkg;drop');
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
});
