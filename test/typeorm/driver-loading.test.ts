import oracleDb from 'oracledb';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseInitializerBase } from '../../src/core/database-initializer-base.js';
import { DataSource } from '../../src/typeorm/data-source/DataSource.js';
import { OracleDriver } from '../../src/typeorm/driver/oracle/OracleDriver.js';
import { PostgresDriver } from '../../src/typeorm/driver/postgres/PostgresDriver.js';
import { TypeORMError } from '../../src/typeorm/error/TypeORMError.js';
import { PlatformTools } from '../../src/typeorm/platform/PlatformTools.js';
import { createLogger } from '../support/helpers.js';

import type { OracleConnectionOptions } from '../../src/typeorm/driver/oracle/OracleConnectionOptions.js';
import type { TOracleDbConfig } from '../../src/types/config.types.js';

interface IOracleOptionsFactory {
  getOracleOptions(
    config: TOracleDbConfig,
    credentials: undefined,
    driver: OracleConnectionOptions['driver']
  ): OracleConnectionOptions;
}

function createOracleConfig(libraryPath?: string): TOracleDbConfig {
  return {
    type: 'oracle',
    master: {
      host: 'localhost',
      port: 1521,
      database: 'service',
      username: 'user',
      password: 'password',
    },
    poolSize: 1,
    ...(libraryPath ? { libraryPath } : {}),
  };
}

function createOracleOptions(
  libraryPath: string | undefined,
  driver: typeof oracleDb
): OracleConnectionOptions {
  const config = createOracleConfig(libraryPath);
  const initializer = new DatabaseInitializerBase(config, {
    module: createLogger(),
  });

  return (initializer as unknown as IOracleOptionsFactory).getOracleOptions(
    config,
    undefined,
    driver
  );
}

function createOracleDriverMock(initOracleClient = vi.fn()): {
  driver: typeof oracleDb;
  initOracleClient: ReturnType<typeof vi.fn>;
} {
  return {
    driver: { initOracleClient } as unknown as typeof oracleDb,
    initOracleClient,
  };
}

describe('bundled database driver loading', (): void => {
  it('keeps synchronous pg-query-stream loading await-compatible', async (): Promise<void> => {
    const loaded = PlatformTools.load('pg-query-stream');

    expect(loaded).not.toBeInstanceOf(Promise);
    await expect(Promise.resolve(loaded)).resolves.toBe(loaded);
  });

  it('loads pg synchronously for a direct DataSource constructor', (): void => {
    const dataSource = new DataSource({ type: 'postgres' });

    expect(dataSource.driver).toBeInstanceOf(PostgresDriver);
    const driver = dataSource.driver as PostgresDriver;
    expect(driver.postgres).toBe(pg);
    expect(driver.postgres).not.toBeInstanceOf(Promise);
    expect(typeof driver.postgres.Pool).toBe('function');
  });

  it('loads oracledb synchronously for a direct thin DataSource constructor', (): void => {
    const dataSource = new DataSource({ type: 'oracle' });

    expect(dataSource.driver).toBeInstanceOf(OracleDriver);
    const driver = dataSource.driver as OracleDriver;
    expect(driver.oracle).toBe(oracleDb);
    expect(driver.oracle).not.toBeInstanceOf(Promise);
    expect(typeof driver.oracle.createPool).toBe('function');
  });
});

describe('Oracle thin and thick initialization', (): void => {
  it('does not initialize Oracle Client when libraryPath is absent', (): void => {
    const { driver, initOracleClient } = createOracleDriverMock();
    const options = createOracleOptions(undefined, driver);

    expect(options.thickMode).toBeUndefined();
    new DataSource(options);

    expect(initOracleClient).not.toHaveBeenCalled();
  });

  it('initializes Oracle Client exactly once with libraryPath as libDir', (): void => {
    const { driver, initOracleClient } = createOracleDriverMock();
    const options = createOracleOptions('/opt/oracle/instantclient', driver);

    expect(options.thickMode).toEqual({
      libDir: '/opt/oracle/instantclient',
    });
    new DataSource(options);

    expect(initOracleClient).toHaveBeenCalledOnce();
    expect(initOracleClient).toHaveBeenCalledWith({
      libDir: '/opt/oracle/instantclient',
    });
  });

  it('reuses one process-wide Oracle Client initialization for matching configs', (): void => {
    const { driver, initOracleClient } = createOracleDriverMock();
    const options = createOracleOptions('/opt/oracle/instantclient', driver);

    new DataSource(options);
    new DataSource(options);

    expect(initOracleClient).toHaveBeenCalledOnce();
  });

  it('rejects conflicting process-wide Oracle Client configurations', (): void => {
    const { driver } = createOracleDriverMock();

    new DataSource(createOracleOptions('/opt/oracle/client-a', driver));

    expect(
      () => new DataSource(createOracleOptions('/opt/oracle/client-b', driver))
    ).toThrow(TypeORMError);
    expect(
      () => new DataSource(createOracleOptions('/opt/oracle/client-b', driver))
    ).toThrow('different Thick mode configuration');
  });

  it('does not reinitialize an externally activated Oracle Thick client', (): void => {
    const initOracleClient = vi.fn();
    const driver = {
      initOracleClient,
      thin: false,
    } as unknown as typeof oracleDb;

    new DataSource(createOracleOptions('/opt/oracle/instantclient', driver));

    expect(initOracleClient).not.toHaveBeenCalled();
  });
});
