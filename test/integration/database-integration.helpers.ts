import oracledb from 'oracledb';
import pg from 'pg';

import { ServerError, TypeOrmProcedureKit } from '../../src/index.js';
import { createLogger } from '../support/helpers.js';

import type {
  IModuleConfig,
  TOracleDbConfig,
  TPostgresDbConfig,
} from '../../src/index.js';
import type { ITestLogger } from '../support/helpers.js';

interface IIntegrationTestSettings<TConfig extends IModuleConfig['config']> {
  config: TConfig;
  logger: { module: ITestLogger };
}

function isIntegrationRequired(database: string): boolean {
  return (
    process.env.RUN_INTEGRATION_TESTS === '1' ||
    (database === 'Oracle' && process.env.ORACLE_INTEGRATION === '1')
  );
}

function handleMissingEnv(database: string): null {
  if (isIntegrationRequired(database)) {
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

export function createPostgresIntegrationSettings(): IIntegrationTestSettings<TPostgresDbConfig> | null {
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
      parseInt8AsNumber: false,
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

export function createPostgresReplicationIntegrationSettings(): IIntegrationTestSettings<TPostgresDbConfig> | null {
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

export function createOracleIntegrationSettings(): IIntegrationTestSettings<TOracleDbConfig> | null {
  const host = process.env.ORACLE_HOST;
  const port = process.env.ORACLE_PORT;
  const database = process.env.ORACLE_DATABASE;
  const username = process.env.ORACLE_USERNAME;
  const password = process.env.ORACLE_PASSWORD;
  const libraryPath = process.env.ORACLE_CLIENT_LIB_DIR;

  if (!host || !port || !database || !username || !password)
    return handleMissingEnv('Oracle');

  return {
    logger: { module: createLogger() },
    config: {
      type: 'oracle',
      poolSize: 2,
      outKeyTransformCase: 'lowerCase',
      ...(libraryPath ? { libraryPath } : {}),
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

/**
 * Switches node-oracledb to Thick mode when the settings carry `libraryPath`; without it the
 * driver stays in Thin mode. Call it before the first standalone connection of a file: Thin mode
 * is fixed once a Thin connection exists. Repeated calls are no-ops because the driver no longer
 * reports Thin mode after the first initialization.
 * @param settings - Oracle integration settings.
 */
export function ensureOracleClientMode(
  settings: IIntegrationTestSettings<TOracleDbConfig>
): void {
  const libraryPath = settings.config.libraryPath;
  if (!libraryPath || !oracledb.thin) return;

  oracledb.initOracleClient({ libDir: libraryPath });
}

/**
 * Runs the callback on a standalone Oracle connection to the master credentials, opened after
 * {@link ensureOracleClientMode}, and closes the connection afterwards.
 * @param settings - Oracle integration settings.
 * @param callback - work to run on the connection.
 * @returns the callback result.
 */
export async function withOracleConnection<TResult>(
  settings: IIntegrationTestSettings<TOracleDbConfig>,
  callback: (connection: oracledb.Connection) => Promise<TResult>
): Promise<TResult> {
  ensureOracleClientMode(settings);
  const { host, port, database, username, password } = settings.config.master;
  const connection = await oracledb.getConnection({
    user: username,
    password,
    connectString: `${host}:${port}/${database}`,
  });

  try {
    return await callback(connection);
  } finally {
    await connection.close();
  }
}

/**
 * Runs the callback on a standalone `pg.Client` connected with the master credentials and ends
 * the client afterwards.
 * @param settings - PostgreSQL integration settings.
 * @param callback - work to run on the client.
 * @returns the callback result.
 */
export async function withPostgresClient<TResult>(
  settings: IIntegrationTestSettings<TPostgresDbConfig>,
  callback: (client: pg.Client) => Promise<TResult>
): Promise<TResult> {
  const { host, port, database, username, password } = settings.config.master;
  const client = new pg.Client({
    host,
    port,
    database,
    user: username,
    password,
  });
  await client.connect();

  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

/**
 * Runs the callback on a kit built from the settings with `configOverrides` spread over
 * `settings.config`. The kit is initialized before the callback and destroyed afterwards, also
 * when `initDatabase()` rejects; the settings object is not modified.
 * @param settings - integration settings for either database.
 * @param configOverrides - config fields that replace those in `settings.config`.
 * @param callback - work to run on the initialized kit.
 * @returns the callback result.
 */
export async function withKit<TConfig extends IModuleConfig['config'], TResult>(
  settings: IIntegrationTestSettings<TConfig>,
  configOverrides: Partial<TConfig>,
  callback: (kit: TypeOrmProcedureKit) => Promise<TResult>
): Promise<TResult> {
  const kit = new TypeOrmProcedureKit({
    ...settings,
    config: { ...settings.config, ...configOverrides },
  });

  try {
    await kit.initDatabase();
    return await callback(kit);
  } finally {
    await kit.destroy();
  }
}
