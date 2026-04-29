import { describe, expect, it, vi } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/core/index.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

function createKit(): TypeOrmProcedureKit {
  return new TypeOrmProcedureKit({
    config: {
      type: 'postgres',
      master: {
        host: 'localhost',
        port: 5432,
        database: 'db',
        username: 'user',
        password: 'pass',
      },
      poolSize: 1,
      parseInt8AsBigInt: false,
    },
    logger: createLogger(),
  });
}

describe('TypeOrmProcedureKit', (): void => {
  it('throws useful errors before initialization', (): void => {
    const kit = createKit();

    expect((): void => {
      kit.call('pkg.run');
    }).toThrow('Procedure packages are not configured');
    expect((): void => {
      kit.setSerializer({
        serializerType: 'DATE',
        strategy: (value: string | Buffer): string => value.toString(),
      });
    }).toThrow(ServerError);
    expect((): void => {
      void kit.serializerReadOnlyMapping;
    }).toThrow(ServerError);
  });

  it('registers shutdown handlers when requested', (): void => {
    const once = vi
      .spyOn(process, 'once')
      .mockImplementation(
        (
          _event: string | symbol,
          _listener: (...args: Array<unknown>) => void
        ): NodeJS.Process => process
      );

    new TypeOrmProcedureKit({
      config: {
        type: 'postgres',
        master: {
          host: 'localhost',
          port: 5432,
          database: 'db',
          username: 'user',
          password: 'pass',
        },
        poolSize: 1,
        parseInt8AsBigInt: false,
      },
      logger: createLogger(),
      isRegisterShutdownHandlers: true,
    });

    expect(once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    once.mockRestore();
  });
});
