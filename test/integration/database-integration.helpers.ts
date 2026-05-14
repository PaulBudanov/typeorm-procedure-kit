import type {
  IModuleConfig,
  TOracleDbConfig,
  TPostgresDbConfig,
} from '../../src/index.js';
import { createLogger, type TestLogger } from '../support/helpers.js';

interface IntegrationTestSettings<TConfig extends IModuleConfig['config']> {
  config: TConfig;
  logger: TestLogger;
}

function isIntegrationRequired(): boolean {
  return process.env.RUN_INTEGRATION_TESTS === '1';
}

function handleMissingEnv(database: string): null {
  if (isIntegrationRequired()) {
    throw new Error(`${database} integration test env is incomplete`);
  }
  return null;
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
    logger: createLogger(),
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

export function createOracleIntegrationSettings(): IntegrationTestSettings<TOracleDbConfig> | null {
  const host = process.env.ORACLE_HOST;
  const port = process.env.ORACLE_PORT;
  const database = process.env.ORACLE_DATABASE;
  const username = process.env.ORACLE_USERNAME;
  const password = process.env.ORACLE_PASSWORD;

  if (!host || !port || !database || !username || !password)
    return handleMissingEnv('Oracle');

  return {
    logger: createLogger(),
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
