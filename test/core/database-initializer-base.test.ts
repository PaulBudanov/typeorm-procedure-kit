import { describe, expect, it } from 'vitest';

import { DatabaseInitializerBase } from '../../src/core/database-initializer-base.js';
import type {
  IBaseConfig,
  IModuleLoggerConfig,
  TOracleDbConfig,
  TPostgresDbConfig,
} from '../../src/index.js';
import type { OracleConnectionOptions } from '../../src/typeorm/driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../../src/typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { DataSourceOptions } from '../../src/typeorm/index.js';
import { ProcedureKitLogger } from '../../src/typeorm/logger/ProcedureKitLogger.js';
import { createLogger } from '../support/helpers.js';

type PostgresOptionsWithStatementTimeout = PostgresConnectionOptions & {
  statement_timeout?: false | number;
};

async function getMaxQueryExecutionTime(
  timeoutConfig: Partial<
    Pick<IBaseConfig, 'callTimeout' | 'maxQueryExecutionTime'>
  >
): Promise<number | undefined> {
  const config: TPostgresDbConfig = {
    type: 'postgres',
    master: {
      host: 'localhost',
      port: 5432,
      database: 'db',
      username: 'user',
      password: 'pass',
    },
    poolSize: 1,
    parseInt8AsBigInt: false,
    ...timeoutConfig,
  };
  const initializer = new DatabaseInitializerBase(config, {
    module: createLogger(),
  });

  await (
    initializer as unknown as { initDataSource(): Promise<void> }
  ).initDataSource();

  return initializer.appDataSource.options.maxQueryExecutionTime;
}

async function getPostgresConnectionOptions(
  configPatch: Partial<TPostgresDbConfig>
): Promise<PostgresOptionsWithStatementTimeout> {
  const config: TPostgresDbConfig = {
    type: 'postgres',
    master: {
      host: 'localhost',
      port: 5432,
      database: 'db',
      username: 'user',
      password: 'pass',
    },
    poolSize: 1,
    parseInt8AsBigInt: false,
    ...configPatch,
  };
  const initializer = new DatabaseInitializerBase(config, {
    module: createLogger(),
  });

  await (
    initializer as unknown as { initDataSource(): Promise<void> }
  ).initDataSource();

  return initializer.appDataSource
    .options as PostgresOptionsWithStatementTimeout;
}

async function getPostgresDataSourceOptions(
  loggerPatch: Partial<IModuleLoggerConfig>
): Promise<DataSourceOptions> {
  const config: TPostgresDbConfig = {
    type: 'postgres',
    master: {
      host: 'localhost',
      port: 5432,
      database: 'db',
      username: 'user',
      password: 'pass',
    },
    poolSize: 1,
    parseInt8AsBigInt: false,
  };
  const initializer = new DatabaseInitializerBase(config, {
    module: createLogger(),
    ...loggerPatch,
  });

  await (
    initializer as unknown as { initDataSource(): Promise<void> }
  ).initDataSource();

  return initializer.appDataSource.options;
}

async function getOracleConnectionOptions(
  configPatch: Partial<TOracleDbConfig>
): Promise<OracleConnectionOptions> {
  const config: TOracleDbConfig = {
    type: 'oracle',
    master: {
      host: 'localhost',
      port: 1521,
      database: 'db',
      username: 'user',
      password: 'pass',
    },
    poolSize: 1,
    ...configPatch,
  };
  const initializer = new DatabaseInitializerBase(config, {
    module: createLogger(),
  });

  await (
    initializer as unknown as { initDataSource(): Promise<void> }
  ).initDataSource();

  return initializer.appDataSource.options as OracleConnectionOptions;
}

describe('DatabaseInitializerBase slow-query threshold config', (): void => {
  it('uses maxQueryExecutionTime as the slow-query threshold', async (): Promise<void> => {
    await expect(
      getMaxQueryExecutionTime({
        callTimeout: 100,
        maxQueryExecutionTime: 200,
      })
    ).resolves.toBe(200);
  });

  it('keeps callTimeout as a deprecated slow-query threshold alias', async (): Promise<void> => {
    await expect(getMaxQueryExecutionTime({ callTimeout: 100 })).resolves.toBe(
      100
    );
  });
});

describe('DatabaseInitializerBase TypeORM logger config', (): void => {
  it('uses the library TypeORM logger bridge without DataSource logging option', async (): Promise<void> => {
    const options = await getPostgresDataSourceOptions({
      typeormLogLevels: ['query', 'error', 'warn'],
    });

    expect(options.logger).toBeInstanceOf(ProcedureKitLogger);
    expect('logging' in options).toBe(false);
  });
});

describe('DatabaseInitializerBase query timeout config', (): void => {
  it('passes queryTimeoutMs to PostgreSQL pool config as statement_timeout', async (): Promise<void> => {
    const options = await getPostgresConnectionOptions({
      queryTimeoutMs: 250,
    });

    expect(options.statement_timeout).toBe(250);
    expect(
      (options.replication?.master as PostgresOptionsWithStatementTimeout)
        .statement_timeout
    ).toBe(250);
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not pass invalid queryTimeoutMs %s to PostgreSQL pool config',
    async (queryTimeoutMs): Promise<void> => {
      const options = await getPostgresConnectionOptions({
        queryTimeoutMs,
      });

      expect(options.statement_timeout).toBeUndefined();
      expect(
        (options.replication?.master as PostgresOptionsWithStatementTimeout)
          .statement_timeout
      ).toBeUndefined();
    }
  );

  it('passes queryTimeoutMs to Oracle connection options', async (): Promise<void> => {
    const options = await getOracleConnectionOptions({
      queryTimeoutMs: 250,
    });

    expect(options.queryTimeoutMs).toBe(250);
    expect(
      (options.replication?.master as OracleConnectionOptions).queryTimeoutMs
    ).toBe(250);
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not pass invalid queryTimeoutMs %s to Oracle connection options',
    async (queryTimeoutMs): Promise<void> => {
      const options = await getOracleConnectionOptions({
        queryTimeoutMs,
      });

      expect(options.queryTimeoutMs).toBeUndefined();
      expect(
        (options.replication?.master as OracleConnectionOptions).queryTimeoutMs
      ).toBeUndefined();
    }
  );
});
