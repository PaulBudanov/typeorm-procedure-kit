import { describe, expect, it, vi } from 'vitest';

import { QueryLogContextStorage } from '../../src/utils/query-log-context.js';
import { QueryTimer } from '../../src/utils/query-timer.js';
import { createLogger } from '../support/helpers.js';

describe('QueryTimer', (): void => {
  it('logs start and success messages', (): void => {
    const logger = createLogger();
    const timer = new QueryTimer('SELECT * FROM users', logger, 'query-1', [1]);

    timer.success(2);

    expect(logger.log).toHaveBeenCalledWith(
      'SQL request [query-1] started: SELECT * FROM users'
    );
    expect(logger.log).toHaveBeenLastCalledWith(
      expect.stringContaining('SQL request [query-1] completed successfully in')
    );
    expect(logger.log.mock.calls.at(-1)?.[0]).toContain('with 2 rows');
    expect(logger.log.mock.calls.at(-1)?.[0]).toContain('Bindings: [1]');
    expect(logger.log.mock.calls.at(-1)?.[0]).not.toContain('\n');
  });

  it('logs multiline SQL as a single line', (): void => {
    const logger = createLogger();

    new QueryTimer(
      `SELECT
        *
       FROM users`,
      logger,
      'query-1'
    );

    expect(logger.log).toHaveBeenCalledWith(
      'SQL request [query-1] started: SELECT * FROM users'
    );
  });

  it('logs procedure calls with readable named bindings', (): void => {
    const logger = createLogger();
    const timer = QueryLogContextStorage.run(
      {
        kind: 'procedure',
        packageName: 'pkg',
        procedureName: 'run',
        bindings: [
          {
            name: 'p_id',
            type: 'NUMBER',
            mode: 'IN',
            value: 7,
          },
          {
            name: 'p_password',
            type: 'VARCHAR2',
            mode: 'IN',
            value: 'secret-password',
          },
          {
            name: 'out_cursor',
            type: 'REF CURSOR',
            mode: 'OUT',
            isCursor: true,
          },
        ],
      },
      () =>
        new QueryTimer(
          'BEGIN PKG.RUN (:p_id,:p_password,:out_cursor); END;',
          logger,
          'query-1',
          [{ val: 7 }, { val: 'secret-password' }, { dir: 3003, type: 2021 }]
        )
    );

    timer.success(1);

    expect(logger.log).toHaveBeenCalledWith(
      'Procedure call [query-1] pkg.run started; Bindings: p_id=7 (NUMBER IN), p_password=[REDACTED] (VARCHAR2 IN), out_cursor=<cursor> (REF CURSOR OUT)'
    );
    const completedMessage = logger.log.mock.calls.at(-1)?.[0] as string;
    expect(completedMessage).toContain(
      'Procedure call [query-1] pkg.run completed successfully'
    );
    expect(completedMessage).toContain('p_id=7 (NUMBER IN)');
    expect(completedMessage).not.toContain('\n');
    expect(completedMessage).not.toContain('secret-password');
  });

  it('logs SQL transaction bindings with parameter names from context', (): void => {
    const logger = createLogger();
    const timer = QueryLogContextStorage.run(
      {
        kind: 'sql',
        bindings: [
          { name: 'ID', value: 7 },
          { name: 'PASSWORD', value: 'secret-password' },
        ],
      },
      () =>
        new QueryTimer(
          'select * from users where id = :ID and password = :PASSWORD',
          logger,
          'query-1',
          [7, 'secret-password']
        )
    );

    timer.success(1);

    expect(logger.log).toHaveBeenCalledWith(
      'SQL request [query-1] started: select * from users where id = :ID and password = :PASSWORD'
    );
    const completedMessage = logger.log.mock.calls.at(-1)?.[0] as string;
    expect(completedMessage).toContain('Bindings: ID=7, PASSWORD=[REDACTED]');
    expect(completedMessage).not.toContain('secret-password');
  });

  it('redacts and safely serializes bindings', (): void => {
    const logger = createLogger();
    const binding: Record<string, unknown> = {
      password: 'secret-password',
      token: 'secret-token',
      count: 1n,
    };
    binding['self'] = binding;
    const timer = new QueryTimer('SELECT 1', logger, 'query-1', [binding]);

    timer.success(1);

    const message = logger.log.mock.calls.at(-1)?.[0] as string;
    expect(message).toContain('"password":"[REDACTED]"');
    expect(message).toContain('"token":"[REDACTED]"');
    expect(message).toContain('"count":"1n"');
    expect(message).toContain('"self":"[Circular]"');
    expect(message).not.toContain('secret-password');
    expect(message).not.toContain('secret-token');
  });

  it('warns for slow successful queries', (): void => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const logger = createLogger();
    const timer = new QueryTimer('SELECT 1', logger, 'slow-query');

    vi.setSystemTime(new Date('2024-01-01T00:00:06.000Z'));
    timer.success();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('slow-query')
    );
    vi.useRealTimers();
  });

  it('logs errors with duration and stack', (): void => {
    const logger = createLogger();
    const timer = new QueryTimer('SELECT 1', logger, 'query-1');
    const error = new Error('bad');

    timer.error(error);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('SQL request [query-1] failed'),
      error.stack
    );
  });
});
