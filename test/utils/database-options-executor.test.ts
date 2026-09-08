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
    'SET LOCAL ROLE app',
    'SET LOCAL search_path TO public',
    'SET LOCAL search_path = public',
    'SET LOCAL search_path TO "$user", public, app_private',
    'SET LOCAL TIME ZONE UTC',
    "SET LOCAL TIME ZONE 'Europe/Moscow'",
    "SET LOCAL app.role = 'app'",
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
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
    'SET ROLE app',
    'SET search_path TO public',
    'SET LOCAL statement_timeout = 0',
    "SET LOCAL arbitrary_setting = 'value'",
    'SET ROLE app; DROP TABLE users',
    'SET ROLE app -- trusted',
    'SET LOCAL ROLE app DROP TABLE users',
    'SET search_path TO public /* trusted */',
    'SET search_path TO public, pg_catalog; SELECT current_user',
    'SET search_path TO public, evil()',
    'SET search_path TO public UNION SELECT current_user',
    "SET LOCAL TIME ZONE 'UTC'; SELECT pg_sleep(1)",
    'SET LOCAL TIME ZONE UTC -- trusted',
    'ALTER SESSION SET CURRENT_SCHEMA = app',
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

  it('rejects direct Oracle mutation without a restoration scope', async (): Promise<void> => {
    const query = vi.fn<(_sql: string) => Promise<unknown>>();

    await expect(
      DatabaseOptionsExecutor.executeCommands(
        ["ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'"],
        { query } as never,
        createLogger()
      )
    ).rejects.toThrow('require executeWithCommands');
    expect(query).not.toHaveBeenCalled();
  });

  it('runs PostgreSQL setup and operation without session capture', async (): Promise<void> => {
    const query = vi
      .fn<(_sql: string) => Promise<unknown>>()
      .mockResolvedValue([]);
    const operation = vi.fn<() => Promise<string>>().mockResolvedValue('done');

    await expect(
      DatabaseOptionsExecutor.executeWithCommands(
        ["SET LOCAL app.role = 'app'"],
        { query } as never,
        createLogger(),
        operation
      )
    ).resolves.toBe('done');

    expect(query).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
  });

  it('captures and restores Oracle NLS state around the operation', async (): Promise<void> => {
    const calls: Array<string> = [];
    const query = vi.fn(async (sql: string): Promise<unknown> => {
      calls.push(sql);
      if (sql.startsWith('SELECT value')) return [{ VALUE: 'DD-MON-RR' }];
      return [];
    });

    const result = await DatabaseOptionsExecutor.executeWithCommands(
      ["ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'"],
      { query } as never,
      createLogger(),
      async (): Promise<string> => {
        calls.push('operation');
        return 'done';
      }
    );

    expect(result).toBe('done');
    expect(calls).toEqual([
      'SELECT value FROM nls_session_parameters WHERE parameter = :1',
      "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'",
      'operation',
      "ALTER SESSION SET NLS_DATE_FORMAT = 'DD-MON-RR'",
    ]);
  });

  it('restores Oracle state when the operation fails', async (): Promise<void> => {
    const query = vi
      .fn<(sql: string) => Promise<unknown>>()
      .mockResolvedValueOnce([{ value: "DD-MON'RR" }])
      .mockResolvedValue([]);
    const error = new Error('operation failed');

    await expect(
      DatabaseOptionsExecutor.executeWithCommands(
        ["ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'"],
        { query } as never,
        createLogger(),
        async (): Promise<never> => {
          throw error;
        }
      )
    ).rejects.toBe(error);

    expect(query).toHaveBeenLastCalledWith(
      "ALTER SESSION SET NLS_DATE_FORMAT = 'DD-MON''RR'"
    );
  });

  it('marks Oracle restoration failures for connection invalidation', async (): Promise<void> => {
    const query = vi
      .fn<(sql: string) => Promise<unknown>>()
      .mockResolvedValueOnce([{ value: 'DD-MON-RR' }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('restore failed'));

    let thrown: unknown;
    try {
      await DatabaseOptionsExecutor.executeWithCommands(
        ["ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'"],
        { query } as never,
        createLogger(),
        async (): Promise<string> => 'done'
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(
      (thrown as unknown as Record<symbol, unknown>)[
        Symbol.for('typeorm-procedure-kit.invalidate-connection')
      ]
    ).toBe(true);
  });

  it('rejects mixed database dialect commands before executing them', async (): Promise<void> => {
    const query = vi.fn<(_sql: string) => Promise<unknown>>();

    await expect(
      DatabaseOptionsExecutor.executeWithCommands(
        [
          "SET LOCAL app.role = 'app'",
          "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'",
        ],
        { query } as never,
        createLogger(),
        async (): Promise<void> => undefined
      )
    ).rejects.toThrow('different dialects');
    expect(query).not.toHaveBeenCalled();
  });
});
