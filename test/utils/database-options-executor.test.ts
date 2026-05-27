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

  it('rejects unsafe raw option commands before execution', async (): Promise<void> => {
    const logger = createLogger();
    const query = vi.fn<(_sql: string) => Promise<unknown>>();

    await expect(
      DatabaseOptionsExecutor.executeCommands(
        ['SET ROLE app; DROP TABLE users'],
        { query } as never,
        logger
      )
    ).rejects.toThrow('Unsafe database option command');
    expect(query).not.toHaveBeenCalled();
  });
});
