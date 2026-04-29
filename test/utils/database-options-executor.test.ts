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
      ['SET ROLE app', 'SET search_path TO public'],
      { query } as never,
      logger
    );

    expect(query).toHaveBeenNthCalledWith(1, 'SET ROLE app');
    expect(query).toHaveBeenNthCalledWith(2, 'SET search_path TO public');
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
        ['SET ROLE app'],
        { query } as never,
        logger
      )
    ).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledWith(
      'Ошибка выполнения команд базы данных: denied',
      error.stack
    );
  });
});
