import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleDriver } from '../../src/typeorm/driver/oracle/OracleDriver.js';
import { PostgresDriver } from '../../src/typeorm/driver/postgres/PostgresDriver.js';

import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';

interface IDisconnectDriver {
  master: object | undefined;
  slaves: Array<object>;
  disconnect(): Promise<void>;
}

function createOracleDriver(): OracleDriver {
  return new OracleDriver({
    options: {
      type: 'oracle',
      driver: oracledb,
      database: 'database',
    },
    subscribers: [],
  } as unknown as DataSource);
}

describe.each([
  {
    vendor: 'Oracle',
    createDriver: (): IDisconnectDriver =>
      createOracleDriver() as unknown as IDisconnectDriver,
  },
  {
    vendor: 'PostgreSQL',
    createDriver: (): IDisconnectDriver =>
      new PostgresDriver() as unknown as IDisconnectDriver,
  },
])('$vendor driver disconnect', ({ createDriver }): void => {
  it('attempts every pool, retains failures, and retries only retained pools', async (): Promise<void> => {
    const driver = createDriver();
    const master = { name: 'master' };
    const firstSlave = { name: 'first-slave' };
    const secondSlave = { name: 'second-slave' };
    const masterError = new Error('master close failed');
    const slaveError = new Error('slave close failed');
    const closePool = vi.fn(async (pool: object): Promise<void> => {
      if (pool === master) throw masterError;
      if (pool === secondSlave) throw slaveError;
    });
    Object.assign(driver, {
      master,
      slaves: [firstSlave, secondSlave],
      closePool,
    });

    const error = await driver.disconnect().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([masterError, slaveError]);
    expect(closePool.mock.calls.map(([pool]) => pool)).toEqual([
      master,
      firstSlave,
      secondSlave,
    ]);
    expect(driver.master).toBe(master);
    expect(driver.slaves).toEqual([secondSlave]);

    closePool.mockResolvedValue(undefined);
    await expect(driver.disconnect()).resolves.toBeUndefined();

    expect(closePool.mock.calls.slice(3).map(([pool]) => pool)).toEqual([
      master,
      secondSlave,
    ]);
    expect(driver.master).toBeUndefined();
    expect(driver.slaves).toEqual([]);
  });

  it('rethrows one pool failure without wrapping it', async (): Promise<void> => {
    const driver = createDriver();
    const master = { name: 'master' };
    const slave = { name: 'slave' };
    const closeError = new Error('slave close failed');
    const closePool = vi.fn(async (pool: object): Promise<void> => {
      if (pool === slave) throw closeError;
    });
    Object.assign(driver, { master, slaves: [slave], closePool });

    await expect(driver.disconnect()).rejects.toBe(closeError);
    expect(driver.master).toBeUndefined();
    expect(driver.slaves).toEqual([slave]);
  });
});
