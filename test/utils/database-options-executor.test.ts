import { describe, expect, it, vi } from 'vitest';

import { DatabaseOptionsExecutor } from '../../src/utils/database-options-executor.js';
import { createLogger } from '../support/helpers.js';

describe('DatabaseOptionsExecutor', (): void => {
  it('executes commands sequentially and logs completion', async (): Promise<void> => {
    const logger = createLogger();
    const query = vi
      .fn<(_sql: string) => Promise<unknown>>()
      .mockResolvedValue([]);

    await DatabaseOptionsExecutor.executeCommands(
      ["SET LOCAL app.role = 'app'", 'SET LOCAL search_path = public'],
      { query } as never,
      logger
    );

    expect(query).toHaveBeenNthCalledWith(1, "SET LOCAL app.role = 'app'");
    expect(query).toHaveBeenNthCalledWith(2, 'SET LOCAL search_path = public');
    expect(logger.log).toHaveBeenLastCalledWith(
      'All commands executed successfully'
    );
  });

  it('logs and rethrows command errors', async (): Promise<void> => {
    const logger = createLogger();
    const error = new Error('denied');
    const query = vi
      .fn<(_sql: string) => Promise<unknown>>()
      .mockRejectedValue(error);

    await expect(
      DatabaseOptionsExecutor.executeCommands(
        ["SET LOCAL app.role = 'app'"],
        { query } as never,
        logger
      )
    ).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledWith(
      'Ошибка выполнения команд базы данных: denied',
      error.stack
    );
  });

  it.each([
    'SET ROLE app',
    'SET LOCAL ROLE app',
    'SET search_path TO public',
    'SET LOCAL search_path TO public',
    'SET LOCAL search_path TO "$user", public, app_private',
    'SET LOCAL TIME ZONE UTC',
    "SET LOCAL TIME ZONE 'Europe/Moscow'",
    "SET LOCAL app.role = 'app'",
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    'ALTER SESSION SET CURRENT_SCHEMA = app',
  ])('executes allowed option command: %s', async (command): Promise<void> => {
    const query = vi
      .fn<(_sql: string) => Promise<unknown>>()
      .mockResolvedValue([]);

    await DatabaseOptionsExecutor.executeCommands(
      [command],
      { query } as never,
      createLogger()
    );

    expect(query).toHaveBeenCalledWith(command);
  });

  it.each([
    'SET ROLE app; DROP TABLE users',
    'SET ROLE app -- trusted',
    'SET LOCAL ROLE app DROP TABLE users',
    'SET search_path TO public /* trusted */',
    'SET search_path TO public, pg_catalog; SELECT current_user',
    'SET search_path TO public, evil()',
    'SET search_path TO public UNION SELECT current_user',
    "SET LOCAL TIME ZONE 'UTC'; SELECT pg_sleep(1)",
    'SET LOCAL TIME ZONE UTC -- trusted',
    'ALTER SESSION SET CURRENT_SCHEMA = app; DROP TABLE users',
    'ALTER SESSION SET CURRENT_SCHEMA = app, OTHER = value',
  ])(
    'rejects unsafe raw option command: %s',
    async (command): Promise<void> => {
      const query = vi.fn<(_sql: string) => Promise<unknown>>();

      await expect(
        DatabaseOptionsExecutor.executeCommands(
          [command],
          { query } as never,
          createLogger()
        )
      ).rejects.toThrow('Unsafe database option command');
      expect(query).not.toHaveBeenCalled();
    }
  );
});
