import oracledb from 'oracledb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OracleConnection } from '../../src/adapters/oracle/oracle-connection.js';
import { createLogger } from '../support/helpers.js';

type GetConnection = (
  options: oracledb.ConnectionAttributes
) => Promise<oracledb.Connection>;

function createOracleConnection(queryTimeoutMs?: number): OracleConnection {
  return new OracleConnection(
    {
      options: {
        queryTimeoutMs,
        replication: {
          master: {
            host: 'localhost',
            port: 1521,
            database: 'service',
            username: 'user',
            password: 'pass',
          },
        },
      },
    } as never,
    createLogger()
  );
}

function mockGetConnection(
  connection: oracledb.Connection
): ReturnType<typeof vi.fn<GetConnection>> {
  return vi
    .spyOn(
      oracledb as unknown as { getConnection: GetConnection },
      'getConnection'
    )
    .mockResolvedValue(connection) as ReturnType<typeof vi.fn<GetConnection>>;
}

describe('OracleConnection', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('applies queryTimeoutMs as callTimeout after creating a standalone connection', async (): Promise<void> => {
    const connection = { callTimeout: 0 };
    const getConnection = mockGetConnection(connection as oracledb.Connection);
    const oracleConnection = createOracleConnection(250);

    await expect(oracleConnection.createSingleConnection()).resolves.toBe(
      connection
    );

    expect(getConnection).toHaveBeenCalledWith({
      user: 'user',
      password: 'pass',
      connectString: 'localhost:1521/service',
      events: true,
      transportConnectTimeout: 10,
    });
    expect(connection.callTimeout).toBe(250);
  });

  it('keeps standalone connection callTimeout unchanged without valid queryTimeoutMs', async (): Promise<void> => {
    const connection = { callTimeout: 25 };
    mockGetConnection(connection as oracledb.Connection);
    const oracleConnection = createOracleConnection(0);

    await expect(oracleConnection.createSingleConnection()).resolves.toBe(
      connection
    );

    expect(connection.callTimeout).toBe(25);
  });
});
