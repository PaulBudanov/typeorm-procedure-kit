import { describe, expect, it } from 'vitest';

import { DatabaseInitializerBase } from '../../src/core/database-initializer-base.js';
import { NotifyBase } from '../../src/core/notify-base.js';
import { ProcedureKitLogger } from '../../src/typeorm/logger/ProcedureKitLogger.js';
import { createLogger } from '../support/helpers.js';

import type {
  IBaseConfig,
  IModuleLoggerConfig,
  TOracleDbConfig,
  TPostgresDbConfig,
} from '../../src/index.js';
import type { OracleConnectionOptions } from '../../src/typeorm/driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../../src/typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { DataSourceOptions } from '../../src/typeorm/index.js';

type TPostgresOptionsWithStatementTimeout = PostgresConnectionOptions & {
  statement_timeout?: false | number;
};

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

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
): Promise<TPostgresOptionsWithStatementTimeout> {
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
    .options as TPostgresOptionsWithStatementTimeout;
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
    expect(options.identifierQuoting).toBe('disabled');
  });

  it('rejects an unknown binding logging policy at runtime', (): void => {
    expect(
      () =>
        new DatabaseInitializerBase(
          {
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
          },
          {
            module: createLogger(),
            bindingLogMode: 'invalid' as 'metadata-only',
          }
        )
    ).toThrow('logger.bindingLogMode');
  });
});

describe('DatabaseInitializerBase session time zone config', (): void => {
  it('passes sessionTimeZone to PostgreSQL connection options', async (): Promise<void> => {
    const previousPgTz = process.env.PGTZ;
    process.env.PGTZ = 'America/New_York';

    try {
      const options = await getPostgresConnectionOptions({
        sessionTimeZone: 'Europe/Moscow',
        slaves: [
          {
            host: 'localhost',
            port: 5432,
            database: 'slave_db',
            username: 'user',
            password: 'pass',
          },
        ],
      });

      expect(options.sessionTimeZone).toBe('Europe/Moscow');
      expect(
        (options.replication?.master as PostgresConnectionOptions)
          .sessionTimeZone
      ).toBe('Europe/Moscow');
      expect(
        (options.replication?.slaves[0] as PostgresConnectionOptions)
          .sessionTimeZone
      ).toBe('Europe/Moscow');
      expect(process.env.PGTZ).toBe('America/New_York');
    } finally {
      restoreEnvValue('PGTZ', previousPgTz);
    }
  });

  it('passes sessionTimeZone to Oracle connection options', async (): Promise<void> => {
    const previousOraSdtz = process.env.ORA_SDTZ;
    process.env.ORA_SDTZ = 'America/New_York';

    try {
      const options = await getOracleConnectionOptions({
        sessionTimeZone: '+03:00',
        slaves: [
          {
            host: 'localhost',
            port: 1521,
            database: 'slave_db',
            username: 'user',
            password: 'pass',
          },
        ],
      });

      expect(options.sessionTimeZone).toBe('+03:00');
      expect(
        (options.replication?.master as OracleConnectionOptions).sessionTimeZone
      ).toBe('+03:00');
      expect(
        (options.replication?.slaves[0] as OracleConnectionOptions)
          .sessionTimeZone
      ).toBe('+03:00');
      expect(process.env.ORA_SDTZ).toBe('America/New_York');
    } finally {
      restoreEnvValue('ORA_SDTZ', previousOraSdtz);
    }
  });
});

describe('DatabaseInitializerBase query timeout config', (): void => {
  it('passes queryTimeoutMs to PostgreSQL pool config as statement_timeout', async (): Promise<void> => {
    const options = await getPostgresConnectionOptions({
      queryTimeoutMs: 250,
    });

    expect(options.statement_timeout).toBe(250);
    expect(
      (options.replication?.master as TPostgresOptionsWithStatementTimeout)
        .statement_timeout
    ).toBe(250);
  });

  it('does not pass an absent queryTimeoutMs to PostgreSQL pool config', async (): Promise<void> => {
    const options = await getPostgresConnectionOptions({});

    expect(options.statement_timeout).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid PostgreSQL queryTimeoutMs %s',
    async (queryTimeoutMs): Promise<void> => {
      await expect(
        getPostgresConnectionOptions({ queryTimeoutMs })
      ).rejects.toThrow(RangeError);
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

  it('does not pass an absent queryTimeoutMs to Oracle connection options', async (): Promise<void> => {
    const options = await getOracleConnectionOptions({});

    expect(options.queryTimeoutMs).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid Oracle queryTimeoutMs %s',
    async (queryTimeoutMs): Promise<void> => {
      await expect(
        getOracleConnectionOptions({ queryTimeoutMs })
      ).rejects.toThrow(RangeError);
    }
  );
});

describe('DatabaseInitializerBase resource config', (): void => {
  it('resolves secure defaults and configured overrides for adapters', async (): Promise<void> => {
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
      resourceLimits: { maxProcedureRows: 25 },
    };
    const initializer = new DatabaseInitializerBase(config, {
      module: createLogger(),
    });

    await (
      initializer as unknown as { initDataSource(): Promise<void> }
    ).initDataSource();

    const adapter = initializer.databaseAdapter as unknown as {
      handlerOptions: {
        resourceLimits: {
          maxProcedureRows: number;
          maxProcedureBytes: number;
          maxMetadataRows: number;
          maxLobBytes: number;
          maxNotificationQueue: number;
          maxNotificationRows: number;
        };
      };
    };
    expect(adapter.handlerOptions.resourceLimits).toEqual({
      maxProcedureRows: 25,
      maxProcedureBytes: 64 * 1024 * 1024,
      maxMetadataRows: 10_000,
      maxLobBytes: 16 * 1024 * 1024,
      maxNotificationQueue: 1_000,
      maxNotificationRows: 10_000,
    });
    expect(Object.isFrozen(adapter.handlerOptions.resourceLimits)).toBe(true);
  });

  it.each([
    { poolSize: 0 },
    { poolSize: 1.5 },
    { resourceLimits: { maxProcedureRows: 0 } },
    { resourceLimits: { maxProcedureBytes: Number.NaN } },
    { resourceLimits: { maxMetadataRows: 0 } },
    { resourceLimits: { maxNotificationRows: 0 } },
  ])('rejects invalid bounded config %#', (patch): void => {
    expect(
      () =>
        new DatabaseInitializerBase(
          {
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
            ...patch,
          },
          { module: createLogger() }
        )
    ).toThrow();
  });
});

describe('DatabaseInitializerBase rollback reset', (): void => {
  it('recreates DataSource and adapter after a real NotifyBase is destroyed', async (): Promise<void> => {
    const initializer = new DatabaseInitializerBase(
      {
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
      },
      { module: createLogger() }
    );
    const initDataSource = (): Promise<void> =>
      (
        initializer as unknown as { initDataSource(): Promise<void> }
      ).initDataSource();

    await initDataSource();
    const firstDataSource = initializer.appDataSource;
    const firstAdapter = initializer.databaseAdapter;
    const firstNotifyBase = new NotifyBase(
      firstAdapter,
      {
        fetchProcedureListWithArguments: (): Promise<void> => Promise.resolve(),
      } as never,
      createLogger()
    );
    await firstNotifyBase.destroy();

    initializer.resetAfterFailedInitialization();
    expect(() => initializer.appDataSource).toThrow(
      'DataSource is not initialized'
    );
    expect(() => initializer.databaseAdapter).toThrow(
      'Database adapter is not initialized'
    );

    await initDataSource();
    expect(initializer.appDataSource).not.toBe(firstDataSource);
    expect(initializer.databaseAdapter).not.toBe(firstAdapter);
    await initializer.databaseAdapter.destroyNotifications();
  });
});
