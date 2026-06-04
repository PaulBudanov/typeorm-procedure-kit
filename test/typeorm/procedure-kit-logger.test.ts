import { describe, expect, it } from 'vitest';

import { ProcedureKitLogger } from '../../src/typeorm/logger/ProcedureKitLogger.js';
import { createLogger } from '../support/helpers.js';

describe('ProcedureKitLogger', (): void => {
  it('does not log TypeORM messages when no levels are configured', (): void => {
    const logger = createLogger();
    const typeormLogger = new ProcedureKitLogger(logger);

    typeormLogger.logQuery('SELECT 1');
    typeormLogger.logQueryError(new Error('bad'), 'SELECT 1');
    typeormLogger.logQuerySlow(10, 'SELECT 1');
    typeormLogger.logSchemaBuild('schema changed');
    typeormLogger.logMigration('migration ran');
    typeormLogger.log('info', 'info message');
    typeormLogger.log('warn', 'warn message');

    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs regular queries only when query level is enabled', (): void => {
    const logger = createLogger();
    const typeormLogger = new ProcedureKitLogger(logger, ['query']);

    typeormLogger.logQuery(
      `SELECT
        *
       FROM users
       WHERE id = $1`,
      [1]
    );
    typeormLogger.logQuerySlow(12, 'SELECT 1');

    expect(logger.log).toHaveBeenCalledWith(
      '[TypeORM query]: SELECT * FROM users WHERE id = $1; Bindings: [1]'
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs slow queries through warn level as one line', (): void => {
    const logger = createLogger();
    const typeormLogger = new ProcedureKitLogger(logger, ['warn']);

    typeormLogger.logQuerySlow(
      42,
      `SELECT
        *
       FROM users`,
      [1]
    );

    const message = logger.warn.mock.calls.at(-1)?.[0] as string;
    expect(message).toBe(
      '[TypeORM slow query (42ms)]: SELECT * FROM users; Bindings: [1]'
    );
    expect(message).not.toContain('\n');
  });

  it('logs query errors through error level with stack', (): void => {
    const logger = createLogger();
    const typeormLogger = new ProcedureKitLogger(logger, ['error']);
    const error = new Error('bad query');

    typeormLogger.logQueryError(error, 'SELECT\n 1', [1]);

    expect(logger.error).toHaveBeenCalledWith(
      '[TypeORM query failed]: SELECT 1; Bindings: [1]; Error: bad query',
      error.stack
    );
  });

  it('logs all configured TypeORM levels', (): void => {
    const logger = createLogger();
    const typeormLogger = new ProcedureKitLogger(logger, 'all');

    typeormLogger.logSchemaBuild('schema\nchanged');
    typeormLogger.logMigration('migration\nran');
    typeormLogger.log('info', 'info\nmessage');
    typeormLogger.log('log', 'generic\nmessage');
    typeormLogger.log('warn', 'warn\nmessage');

    expect(logger.log).toHaveBeenCalledWith('TypeORM schema: schema changed');
    expect(logger.log).toHaveBeenCalledWith('TypeORM migration: migration ran');
    expect(logger.log).toHaveBeenCalledWith('TypeORM info: info message');
    expect(logger.log).toHaveBeenCalledWith('TypeORM log: generic message');
    expect(logger.warn).toHaveBeenCalledWith('TypeORM warn: warn message');
  });
});
