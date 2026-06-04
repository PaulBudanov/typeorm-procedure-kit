import {
  ServerError,
  type IModuleConfig,
  type TOracleDbConfig,
  type TPostgresDbConfig,
} from '../../src/index.js';
import { createLogger, type TestLogger } from '../support/helpers.js';

interface IntegrationTestSettings<TConfig extends IModuleConfig['config']> {
  config: TConfig;
  logger: { module: TestLogger };
}

function isIntegrationRequired(): boolean {
  return process.env.RUN_INTEGRATION_TESTS === '1';
}

function handleMissingEnv(database: string): null {
  if (isIntegrationRequired()) {
    throw new ServerError(`${database} integration test env is incomplete`);
  }
  return null;
}

function cloneCredentials(
  credentials: TPostgresDbConfig['master']
): TPostgresDbConfig['master'] {
  return { ...credentials };
}

function getPostgresSlaveCredentials(
  master: TPostgresDbConfig['master']
): TPostgresDbConfig['master'] {
  const host = process.env.POSTGRES_SLAVE_HOST;
  const port = process.env.POSTGRES_SLAVE_PORT;
  const database = process.env.POSTGRES_SLAVE_DATABASE;
  const username = process.env.POSTGRES_SLAVE_USERNAME;
  const password = process.env.POSTGRES_SLAVE_PASSWORD;

  if (!host || !port || !database || !username || !password)
    return cloneCredentials(master);

  return {
    host,
    port: Number(port),
    database,
    username,
    password,
  };
}

export function createPostgresIntegrationSettings(): IntegrationTestSettings<TPostgresDbConfig> | null {
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT;
  const database = process.env.POSTGRES_DATABASE;
  const username = process.env.POSTGRES_USERNAME;
  const password = process.env.POSTGRES_PASSWORD;

  if (!host || !port || !database || !username || !password)
    return handleMissingEnv('PostgreSQL');

  return {
    logger: { module: createLogger() },
    config: {
      type: 'postgres',
      parseInt8AsBigInt: false,
      poolSize: 2,
      outKeyTransformCase: 'lowerCase',
      master: {
        host,
        port: Number(port),
        database,
        username,
        password,
      },
    },
  };
}

export function createPostgresReplicationIntegrationSettings(): IntegrationTestSettings<TPostgresDbConfig> | null {
  const settings = createPostgresIntegrationSettings();

  if (!settings) return null;

  return {
    ...settings,
    config: {
      ...settings.config,
      slaves: [getPostgresSlaveCredentials(settings.config.master)],
    },
  };
}

export function createOracleIntegrationSettings(): IntegrationTestSettings<TOracleDbConfig> | null {
  const host = process.env.ORACLE_HOST;
  const port = process.env.ORACLE_PORT;
  const database = process.env.ORACLE_DATABASE;
  const username = process.env.ORACLE_USERNAME;
  const password = process.env.ORACLE_PASSWORD;

  if (!host || !port || !database || !username || !password)
    return handleMissingEnv('Oracle');

  return {
    logger: { module: createLogger() },
    config: {
      type: 'oracle',
      poolSize: 2,
      outKeyTransformCase: 'lowerCase',
      master: {
        host,
        port: Number(port),
        database,
        username,
        password,
      },
    },
  };
}
