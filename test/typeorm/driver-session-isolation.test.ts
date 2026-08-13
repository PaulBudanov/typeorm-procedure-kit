import oracledb from 'oracledb';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import type { OracleConnectionOptions } from '../../src/typeorm/driver/oracle/OracleConnectionOptions.js';
import { OracleDriver } from '../../src/typeorm/driver/oracle/OracleDriver.js';
import type { PostgresConnectionOptions } from '../../src/typeorm/driver/postgres/PostgresConnectionOptions.js';
import { PostgresDriver } from '../../src/typeorm/driver/postgres/PostgresDriver.js';
import { normalizeSessionTimeZone } from '../../src/typeorm/driver/SessionTimeZone.js';

class TestOracleDriver extends OracleDriver {
  public createTestPool(): Promise<oracledb.Pool> {
    return this.createPool(this.options, this.options);
  }
}

class TestPostgresDriver extends PostgresDriver {
  public createTestPool(): Promise<pg.Pool> {
    return this.createPool(this.options, this.options);
  }
}

describe('driver session isolation', (): void => {
  it('maps every Oracle temporal type to its exact native type', (): void => {
    const driver = new TestOracleDriver({
      options: {
        type: 'oracle',
        driver: oracledb,
        database: 'database',
      },
    } as unknown as DataSource);

    expect(driver.columnTypeToNativeParameter('date')).toBe(
      oracledb.DB_TYPE_DATE
    );
    expect(driver.columnTypeToNativeParameter('timestamp')).toBe(
      oracledb.DB_TYPE_TIMESTAMP
    );
    expect(driver.columnTypeToNativeParameter('timestamp with time zone')).toBe(
      oracledb.DB_TYPE_TIMESTAMP_TZ
    );
    expect(
      driver.columnTypeToNativeParameter('timestamp with local time zone')
    ).toBe(oracledb.DB_TYPE_TIMESTAMP_LTZ);
  });

  it('configures Oracle timezone for every physical pooled connection', async (): Promise<void> => {
    let poolOptions: oracledb.PoolAttributes | undefined;
    const createPool = vi.fn(
      (
        options: oracledb.PoolAttributes,
        callback: (error: unknown, pool: oracledb.Pool) => void
      ): void => {
        poolOptions = options;
        callback(undefined, {} as oracledb.Pool);
      }
    );
    const oracleDriver = new Proxy(oracledb, {
      get(target, property, receiver): unknown {
        if (property === 'createPool') return createPool;
        return Reflect.get(target, property, receiver);
      },
    });
    const driver = new TestOracleDriver({
      options: {
        type: 'oracle',
        driver: oracleDriver,
        database: 'database',
        sessionTimeZone: '+03:00',
      } satisfies OracleConnectionOptions,
    } as unknown as DataSource);

    await driver.createTestPool();
    const execute = vi.fn().mockResolvedValue(undefined);
    const sessionCallback = poolOptions?.sessionCallback;
    if (typeof sessionCallback !== 'function') {
      throw new TypeError('Expected an Oracle session callback function');
    }
    await new Promise<void>((resolve, reject) => {
      sessionCallback(
        { execute } as unknown as oracledb.Connection,
        '',
        (error?: unknown) => (error ? reject(error) : resolve())
      );
    });

    expect(execute).toHaveBeenCalledWith(
      "ALTER SESSION SET TIME_ZONE = '+03:00'"
    );
  });

  it('passes timezone and custom parsers through each PostgreSQL pool', async (): Promise<void> => {
    let poolOptions: pg.PoolConfig | undefined;
    const pool = {
      on: vi.fn(),
      connect: vi.fn(
        (
          callback: (
            error: Error | undefined,
            client: pg.PoolClient,
            done: () => void
          ) => void
        ): void => {
          callback(
            undefined,
            { on: vi.fn() } as unknown as pg.PoolClient,
            vi.fn()
          );
        }
      ),
    } as unknown as pg.Pool;
    const Pool = vi.fn(function (options: pg.PoolConfig): pg.Pool {
      poolOptions = options;
      return pool;
    });
    const postgresDriver = new Proxy(pg, {
      get(target, property, receiver): unknown {
        if (property === 'Pool') return Pool;
        return Reflect.get(target, property, receiver);
      },
    });
    const driver = new TestPostgresDriver({
      options: {
        type: 'postgres',
        driver: postgresDriver,
        database: 'database',
        sessionTimeZone: 'Europe/Moscow',
      } satisfies PostgresConnectionOptions,
      logger: { log: vi.fn() },
    } as unknown as DataSource);
    const typeOverrides = new pg.TypeOverrides();
    driver.configureResultHandling(typeOverrides, (rows) => rows);

    await driver.createTestPool();

    expect(poolOptions?.options).toBe('-c timezone=Europe/Moscow');
    expect(poolOptions?.types).toBe(typeOverrides);
  });

  it('keeps parseInt8 overrides isolated per PostgreSQL driver', async (): Promise<void> => {
    const typeRegistry = pg.types as unknown as {
      builtins: { INT8: number };
      getTypeParser: (oid: number) => (value: string) => unknown;
    };
    const globalInt8Parser = typeRegistry.getTypeParser(
      typeRegistry.builtins.INT8
    );

    const createPoolOptions = async (
      parseInt8: boolean
    ): Promise<pg.PoolConfig> => {
      let poolOptions: pg.PoolConfig | undefined;
      const pool = {
        on: vi.fn(),
        connect: vi.fn(
          (
            callback: (
              error: Error | undefined,
              client: pg.PoolClient,
              done: () => void
            ) => void
          ): void => {
            callback(
              undefined,
              { on: vi.fn() } as unknown as pg.PoolClient,
              vi.fn()
            );
          }
        ),
      } as unknown as pg.Pool;
      const Pool = vi.fn(function (options: pg.PoolConfig): pg.Pool {
        poolOptions = options;
        return pool;
      });
      const postgresDriver = new Proxy(pg, {
        get(target, property, receiver): unknown {
          if (property === 'Pool') return Pool;
          return Reflect.get(target, property, receiver);
        },
      });
      const driver = new TestPostgresDriver({
        options: {
          type: 'postgres',
          driver: postgresDriver,
          database: 'database',
          parseInt8,
        } satisfies PostgresConnectionOptions,
        logger: { log: vi.fn() },
      } as unknown as DataSource);
      driver.configureResultHandling(new pg.TypeOverrides(), (rows) => rows);

      await driver.createTestPool();
      if (!poolOptions) throw new TypeError('Expected PostgreSQL pool options');
      return poolOptions;
    };

    const stringInt8Pool = await createPoolOptions(false);
    const numberInt8Pool = await createPoolOptions(true);

    expect(
      stringInt8Pool.types?.getTypeParser(typeRegistry.builtins.INT8)('42')
    ).toBe('42');
    expect(
      numberInt8Pool.types?.getTypeParser(typeRegistry.builtins.INT8)('42')
    ).toBe(42);
    expect(typeRegistry.getTypeParser(typeRegistry.builtins.INT8)).toBe(
      globalInt8Parser
    );
  });

  it('rejects parseInt8 when the pg runtime lacks TypeOverrides', async (): Promise<void> => {
    const postgresWithoutTypeOverrides = new Proxy(pg, {
      get(target, property, receiver): unknown {
        if (property === 'TypeOverrides') return undefined;
        return Reflect.get(target, property, receiver);
      },
    });
    const driver = new TestPostgresDriver({
      options: {
        type: 'postgres',
        driver: postgresWithoutTypeOverrides,
        database: 'database',
        parseInt8: true,
      } satisfies PostgresConnectionOptions,
      logger: { log: vi.fn() },
    } as unknown as DataSource);

    await expect(driver.createTestPool()).rejects.toThrow(
      'PostgreSQL driver does not expose the TypeOverrides capability'
    );
  });

  it('defaults to UTC and rejects unsafe or unknown timezone values', (): void => {
    expect(normalizeSessionTimeZone()).toBe('UTC');
    expect(normalizeSessionTimeZone('Europe/Moscow')).toBe('Europe/Moscow');
    expect(normalizeSessionTimeZone('-14:00')).toBe('-14:00');
    expect(() => normalizeSessionTimeZone("UTC' OR 1=1 --")).toThrow();
    expect(() => normalizeSessionTimeZone('Mars/Olympus_Mons')).toThrow();
    expect(() => normalizeSessionTimeZone('+14:01')).toThrow();
  });
});
