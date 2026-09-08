import { describe, expect, it, vi } from 'vitest';

import { OracleQueryRunner } from '../../src/typeorm/driver/oracle/OracleQueryRunner.js';
import { PostgresQueryRunner } from '../../src/typeorm/driver/postgres/PostgresQueryRunner.js';
import { EntityManager } from '../../src/typeorm/entity-manager/EntityManager.js';

import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import type { QueryRunner } from '../../src/typeorm/query-runner/QueryRunner.js';

type TMutableQueryRunner = {
  -readonly [Key in keyof QueryRunner]: QueryRunner[Key];
};

describe('QueryRunner failed-connection invalidation', (): void => {
  it('drops an Oracle physical connection only when release receives an error', async (): Promise<void> => {
    const close = vi.fn().mockResolvedValue(undefined);
    const driver = { connection: { subscribers: [] } };
    const failedRunner = new OracleQueryRunner(driver as never, 'master');
    Object.assign(failedRunner as object, { databaseConnection: { close } });
    const error = new Error('session restore failed');

    await failedRunner.release(error);

    expect(close).toHaveBeenCalledWith({ drop: true });

    const healthyClose = vi.fn().mockResolvedValue(undefined);
    const healthyRunner = new OracleQueryRunner(driver as never, 'master');
    Object.assign(healthyRunner as object, {
      databaseConnection: { close: healthyClose },
    });
    await healthyRunner.release();
    expect(healthyClose).toHaveBeenCalledWith();
  });

  it('passes an invalidating error to the native PostgreSQL release callback', async (): Promise<void> => {
    const releaseCallback = vi.fn();
    const connection = { removeListener: vi.fn() };
    const dataSource = { subscribers: [] } as Record<string, unknown>;
    const driver = {
      connection: dataSource,
      connectedQueryRunners: [],
    };
    dataSource.driver = driver;
    const runner = new PostgresQueryRunner(driver as never, 'master');
    Object.assign(runner as object, {
      databaseConnection: connection,
      releaseCallback,
    });
    const error = new Error('connection uncertain');

    await runner.release(error);

    expect(releaseCallback).toHaveBeenCalledWith(error);
  });

  it('does not invalidate after a normal callback error and successful rollback', async (): Promise<void> => {
    const callbackError = new Error('business rule rejected');
    const queryRunner = createTransactionQueryRunner();
    const manager = createEntityManager(queryRunner);

    await expect(
      manager.transaction((): Promise<never> => Promise.reject(callbackError))
    ).rejects.toBe(callbackError);

    expect(queryRunner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(queryRunner.release).toHaveBeenCalledWith(undefined);
  });

  it('invalidates on an explicit restore marker and on commit uncertainty', async (): Promise<void> => {
    const restoreError = new Error('restore failed');
    Object.defineProperty(
      restoreError,
      Symbol.for('typeorm-procedure-kit.invalidate-connection'),
      { value: true }
    );
    const markedRunner = createTransactionQueryRunner();
    const markedManager = createEntityManager(markedRunner);

    await expect(
      markedManager.transaction(
        (): Promise<never> => Promise.reject(restoreError)
      )
    ).rejects.toBe(restoreError);
    expect(markedRunner.release).toHaveBeenCalledWith(restoreError);

    const commitError = new Error('commit failed');
    const commitRunner = createTransactionQueryRunner();
    vi.mocked(commitRunner.commitTransaction).mockRejectedValue(commitError);
    const commitManager = createEntityManager(commitRunner);
    await expect(
      commitManager.transaction((): Promise<string> => Promise.resolve('ok'))
    ).rejects.toBe(commitError);
    expect(commitRunner.release).toHaveBeenCalledWith(commitError);
  });

  it('only rolls back a failed transaction start when it became active', async (): Promise<void> => {
    const beforeStartError = new Error('before start rejected');
    const inactiveRunner = createTransactionQueryRunner();
    vi.mocked(inactiveRunner.startTransaction).mockRejectedValue(
      beforeStartError
    );
    const inactiveManager = createEntityManager(inactiveRunner);

    await expect(
      inactiveManager.transaction((): Promise<void> => Promise.resolve())
    ).rejects.toBe(beforeStartError);
    expect(inactiveRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(inactiveRunner.release).toHaveBeenCalledWith(undefined);

    const partialStartError = new Error('start query failed');
    const activeRunner = createTransactionQueryRunner();
    vi.mocked(activeRunner.startTransaction).mockImplementation(
      (): Promise<void> => {
        activeRunner.isTransactionActive = true;
        return Promise.reject(partialStartError);
      }
    );
    const activeManager = createEntityManager(activeRunner);
    await expect(
      activeManager.transaction((): Promise<void> => Promise.resolve())
    ).rejects.toBe(partialStartError);
    expect(activeRunner.rollbackTransaction).toHaveBeenCalledOnce();
  });

  it('immediately invalidates an externally scoped runner only for unsafe failures', async (): Promise<void> => {
    const dataSource = {} as DataSource;
    const ordinaryRunner = createTransactionQueryRunner();
    const ordinaryManager = new EntityManager(dataSource, ordinaryRunner);
    await expect(
      ordinaryManager.transaction(
        (): Promise<never> =>
          Promise.reject(new Error('ordinary callback failure'))
      )
    ).rejects.toThrow('ordinary callback failure');
    expect(ordinaryRunner.release).not.toHaveBeenCalled();

    const unsafeError = new Error('session restore failed');
    Object.defineProperty(
      unsafeError,
      Symbol.for('typeorm-procedure-kit.invalidate-connection'),
      { value: true }
    );
    const unsafeRunner = createTransactionQueryRunner();
    const unsafeManager = new EntityManager(dataSource, unsafeRunner);
    await expect(
      unsafeManager.transaction(
        (): Promise<never> => Promise.reject(unsafeError)
      )
    ).rejects.toBe(unsafeError);
    expect(unsafeRunner.release).toHaveBeenCalledWith(unsafeError);
  });
});

function createTransactionQueryRunner(): TMutableQueryRunner {
  const queryRunner = {
    isReleased: false,
    manager: undefined,
    startTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  } as unknown as TMutableQueryRunner;
  vi.mocked(queryRunner.startTransaction).mockImplementation(
    (): Promise<void> => {
      queryRunner.isTransactionActive = true;
      return Promise.resolve();
    }
  );
  return queryRunner;
}

function createEntityManager(queryRunner: QueryRunner): EntityManager {
  const dataSource = {
    createQueryRunner: vi.fn(() => queryRunner),
  } as unknown as DataSource;
  return new EntityManager(dataSource);
}
