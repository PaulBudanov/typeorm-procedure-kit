import { describe, expect, it, vi } from 'vitest';

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
