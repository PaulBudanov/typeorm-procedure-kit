import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleDriver } from '../../src/typeorm/driver/oracle/OracleDriver.js';
import { OracleQueryRunner } from '../../src/typeorm/driver/oracle/OracleQueryRunner.js';

import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';

function createOracleDriver(isReplicationEnabled = false): OracleDriver {
  return new OracleDriver({
    options: {
      type: 'oracle',
      driver: oracledb,
      database: 'database',
      ...(isReplicationEnabled
        ? {
            replication: {
              master: { connectString: 'master' },
              slaves: [
                { connectString: 'slave-1' },
                { connectString: 'slave-2' },
              ],
            },
          }
        : {}),
    },
    subscribers: [],
  } as unknown as DataSource);
}

function replacePoolMethods(
  driver: OracleDriver,
  createPool: () => Promise<oracledb.Pool>,
  closePool: (pool: oracledb.Pool) => Promise<void>
): void {
  Object.assign(driver as object, { createPool, closePool });
}

describe('Oracle driver bootstrap', (): void => {
  it('reads the server version from the physical connection without querying V$INSTANCE', async (): Promise<void> => {
    const runner = new OracleQueryRunner(
      { connection: { subscribers: [] } } as never,
      'master'
    );
    Object.assign(runner as object, {
      databaseConnection: { oracleServerVersionString: '23.5.0.24.7' },
    });
    const query = vi.spyOn(runner, 'query');

    await expect(runner.getVersion()).resolves.toBe('23.5.0.24.7');
    expect(query).not.toHaveBeenCalled();
  });

  it('loads whichever bootstrap property is missing and always releases the runner', async (): Promise<void> => {
    const driver = createOracleDriver();
    driver.schema = 'APP';
    const pool = {} as oracledb.Pool;
    const closePool = vi.fn().mockResolvedValue(undefined);
    replacePoolMethods(driver, vi.fn().mockResolvedValue(pool), closePool);
    const queryRunner = {
      getCurrentSchema: vi.fn().mockResolvedValue('IGNORED'),
      getVersion: vi.fn().mockResolvedValue('19.0.0.0.0'),
      release: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(driver, 'createQueryRunner').mockReturnValue(queryRunner as never);

    await driver.connect();

    expect(queryRunner.getCurrentSchema).not.toHaveBeenCalled();
    expect(queryRunner.getVersion).toHaveBeenCalledOnce();
    expect(queryRunner.release).toHaveBeenCalledOnce();
    expect(driver.version).toBe('19.0.0.0.0');
    expect(driver.master).toBe(pool);
    expect(closePool).not.toHaveBeenCalled();
  });

  it('preserves simultaneous metadata and runner release errors', async (): Promise<void> => {
    const driver = createOracleDriver();
    const pool = {} as oracledb.Pool;
    const closePool = vi.fn().mockResolvedValue(undefined);
    replacePoolMethods(driver, vi.fn().mockResolvedValue(pool), closePool);
    const metadataError = new Error('metadata failed');
    const releaseError = new Error('release failed');
    vi.spyOn(driver, 'createQueryRunner').mockReturnValue({
      getCurrentSchema: vi.fn().mockRejectedValue(metadataError),
      getVersion: vi.fn(),
      release: vi.fn().mockRejectedValue(releaseError),
    } as never);

    const error = await driver.connect().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      metadataError,
      releaseError,
    ]);
    expect((error as AggregateError).cause).toBe(metadataError);
    expect(closePool).toHaveBeenCalledWith(pool);
    expect(driver.master).toBeUndefined();
    expect(driver.slaves).toEqual([]);
  });

  it('preserves a bootstrap error together with pool cleanup failures', async (): Promise<void> => {
    const driver = createOracleDriver();
    const pool = {} as oracledb.Pool;
    const metadataError = new Error('metadata failed');
    const cleanupError = new Error('pool close failed');
    const closePool = vi.fn().mockRejectedValue(cleanupError);
    replacePoolMethods(driver, vi.fn().mockResolvedValue(pool), closePool);
    vi.spyOn(driver, 'createQueryRunner').mockReturnValue({
      getCurrentSchema: vi.fn().mockRejectedValue(metadataError),
      getVersion: vi.fn(),
      release: vi.fn().mockResolvedValue(undefined),
    } as never);

    const error = await driver.connect().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      metadataError,
      cleanupError,
    ]);
    expect((error as AggregateError).cause).toBe(metadataError);
    expect(closePool).toHaveBeenCalledWith(pool);
    expect(driver.master).toBeUndefined();
    expect(driver.slaves).toEqual([pool]);

    closePool.mockResolvedValueOnce(undefined);
    await driver.disconnect();

    expect(closePool).toHaveBeenCalledTimes(2);
    expect(driver.slaves).toEqual([]);
  });

  it('closes already-created replication pools when later pool creation fails', async (): Promise<void> => {
    const driver = createOracleDriver(true);
    const firstPool = {} as oracledb.Pool;
    const creationError = new Error('second slave failed');
    const createPool = vi
      .fn<() => Promise<oracledb.Pool>>()
      .mockResolvedValueOnce(firstPool)
      .mockRejectedValueOnce(creationError);
    const closePool = vi.fn().mockResolvedValue(undefined);
    replacePoolMethods(driver, createPool, closePool);

    await expect(driver.connect()).rejects.toBe(creationError);
    expect(closePool).toHaveBeenCalledOnce();
    expect(closePool).toHaveBeenCalledWith(firstPool);
    expect(driver.master).toBeUndefined();
    expect(driver.slaves).toEqual([]);
  });
});
