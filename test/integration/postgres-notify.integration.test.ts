import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/index.js';
import { createLogger } from '../support/helpers.js';

import { createPostgresIntegrationSettings } from './database-integration.helpers.js';

import type { TPostgresDbConfig } from '../../src/index.js';
import type { ITestLogger } from '../support/helpers.js';

const settings = createPostgresIntegrationSettings();
const packageSchema = 'tpk_it_notify_pkg' as const;
const packageChannel = 'db_object_event';
const waitOptions = { timeout: 10_000, interval: 100 } as const;
/**
 * Delays of the restore loop: the smallest the notifier accepts, so a failed
 * reconnect attempt is retried within the test timeout.
 */
const restoreOptions = {
  maxRetries: 20,
  retryDelayMs: 100,
  retryAfterMaxDelayMs: 100,
} as const;

type TPostgresIntegrationSettings = NonNullable<typeof settings>;

interface INotifyPayload {
  marker: string;
  sequence: number;
}

interface INotifyKit {
  kit: TypeOrmProcedureKit;
  logger: ITestLogger;
}

interface IDescribeValueRow {
  result: number;
  label?: string;
  revision: string;
}

/**
 * Builds a kit with its own logger and application name. The application
 * name is how the tests find the kit's backends in pg_stat_activity.
 */
function createNotifyKit(
  integrationSettings: TPostgresIntegrationSettings,
  appName: string,
  packagesSettings?: TPostgresDbConfig['packagesSettings']
): INotifyKit {
  const logger = createLogger();
  const kit = new TypeOrmProcedureKit({
    ...integrationSettings,
    logger: { module: logger },
    config: {
      ...integrationSettings.config,
      appName,
      ...(packagesSettings ? { packagesSettings } : {}),
    },
  });
  return { kit, logger };
}

async function connectClient(
  integrationSettings: TPostgresIntegrationSettings
): Promise<pg.Client> {
  const client = new pg.Client({
    host: integrationSettings.config.master.host,
    port: integrationSettings.config.master.port,
    database: integrationSettings.config.master.database,
    user: integrationSettings.config.master.username,
    password: integrationSettings.config.master.password,
    application_name: 'tpk_it_notify_control',
  });
  await client.connect();
  return client;
}

async function withPostgresClient<T>(
  integrationSettings: TPostgresIntegrationSettings,
  callback: (client: pg.Client) => Promise<T>
): Promise<T> {
  const client = await connectClient(integrationSettings);
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function sendNotification(
  client: pg.Client,
  channel: string,
  payload: object
): Promise<void> {
  await client.query('SELECT pg_notify($1, $2)', [
    channel,
    JSON.stringify(payload),
  ]);
}

/**
 * Returns the backends of one kit whose last statement was LISTEN. The
 * notifier's health check replaces that statement with `SELECT 1` after
 * 15 seconds, so the lookups run right after a registration or a restore.
 */
async function findListenerPids(
  client: pg.Client,
  appName: string
): Promise<Array<number>> {
  const result = await client.query<{ pid: number }>(
    `SELECT pid
       FROM pg_stat_activity
      WHERE application_name = $1
        AND state = 'idle'
        AND query LIKE 'LISTEN %'
      ORDER BY pid`,
    [appName]
  );
  return result.rows.map(({ pid }) => pid);
}

async function findBackendPids(
  client: pg.Client,
  appName: string
): Promise<Array<number>> {
  const result = await client.query<{ pid: number }>(
    'SELECT pid FROM pg_stat_activity WHERE application_name = $1 ORDER BY pid',
    [appName]
  );
  return result.rows.map(({ pid }) => pid);
}

async function createDescribeValueV1(
  integrationSettings: TPostgresIntegrationSettings
): Promise<void> {
  await withPostgresClient(integrationSettings, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${packageSchema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${packageSchema}"`);
    await client.query(`
      CREATE PROCEDURE "${packageSchema}".describe_value(
        IN p_value integer,
        INOUT out_cursor refcursor
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        OPEN out_cursor FOR
          SELECT p_value AS result, 'v1'::text AS revision;
      END;
      $$;
    `);
  });
}

async function replaceDescribeValueWithV2(
  integrationSettings: TPostgresIntegrationSettings
): Promise<void> {
  await withPostgresClient(integrationSettings, async (client) => {
    await client.query(
      `DROP PROCEDURE "${packageSchema}".describe_value(integer, refcursor)`
    );
    await client.query(`
      CREATE PROCEDURE "${packageSchema}".describe_value(
        IN p_value integer,
        IN p_label text,
        INOUT out_cursor refcursor
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        OPEN out_cursor FOR
          SELECT p_value AS result, p_label AS label, 'v2'::text AS revision;
      END;
      $$;
    `);
  });
}

async function dropPackageSchema(
  integrationSettings: TPostgresIntegrationSettings
): Promise<void> {
  await withPostgresClient(integrationSettings, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${packageSchema}" CASCADE`);
  });
}

describe.skipIf(!settings)(
  'PostgreSQL LISTEN/NOTIFY integration',
  { timeout: 30_000 },
  (): void => {
    it('delivers a NOTIFY sent from another session to the callback', async (): Promise<void> => {
      const appName = 'tpk_it_notify_deliver';
      const { kit } = createNotifyKit(settings!, appName);
      const control = await connectClient(settings!);
      const received: Array<INotifyPayload> = [];

      try {
        await kit.initDatabase();
        const channel = await kit.makeNotify<INotifyPayload>({
          sql: 'LISTEN tpk_it_notify_deliver',
          notifyCallback: (payload): void => {
            received.push(payload);
          },
        });

        expect(channel).toBe('tpk_it_notify_deliver');
        expect(await findListenerPids(control, appName)).toHaveLength(1);

        await sendNotification(control, channel, {
          marker: 'deliver',
          sequence: 1,
        });

        await vi.waitFor((): void => {
          expect(received).toEqual([{ marker: 'deliver', sequence: 1 }]);
        }, waitOptions);
      } finally {
        await control.end();
        await kit.destroy();
      }
    });

    it('stops delivering after unlistenNotify and lets the channel be registered again', async (): Promise<void> => {
      const appName = 'tpk_it_notify_unlisten';
      const { kit } = createNotifyKit(settings!, appName);
      const control = await connectClient(settings!);
      const observer = await connectClient(settings!);
      const received: Array<INotifyPayload> = [];
      const observed: Array<INotifyPayload> = [];
      const notifyCallback = (payload: INotifyPayload): void => {
        received.push(payload);
      };

      try {
        await kit.initDatabase();
        const channel = await kit.makeNotify<INotifyPayload>({
          sql: 'LISTEN tpk_it_notify_unlisten',
          notifyCallback,
        });
        await sendNotification(control, channel, {
          marker: 'before-unlisten',
          sequence: 1,
        });
        await vi.waitFor((): void => {
          expect(received).toEqual([
            { marker: 'before-unlisten', sequence: 1 },
          ]);
        }, waitOptions);

        await kit.unlistenNotify(channel);

        // The listening connection itself is closed, not only unregistered.
        await vi.waitFor(async (): Promise<void> => {
          expect(await findListenerPids(control, appName)).toEqual([]);
        }, waitOptions);

        // An independent listener proves the notification was sent and
        // delivered; the grace period covers the kit's own event dispatch.
        observer.on('notification', (message): void => {
          if (message.channel === channel && message.payload) {
            observed.push(JSON.parse(message.payload) as INotifyPayload);
          }
        });
        await observer.query(`LISTEN "${channel}"`);
        await sendNotification(control, channel, {
          marker: 'after-unlisten',
          sequence: 2,
        });
        await vi.waitFor((): void => {
          expect(observed).toEqual([{ marker: 'after-unlisten', sequence: 2 }]);
        }, waitOptions);
        await delay(250);
        expect(received).toEqual([{ marker: 'before-unlisten', sequence: 1 }]);

        await expect(
          kit.makeNotify<INotifyPayload>({
            sql: 'LISTEN tpk_it_notify_unlisten',
            notifyCallback,
          })
        ).resolves.toBe(channel);
        await sendNotification(control, channel, {
          marker: 'registered-again',
          sequence: 3,
        });
        await vi.waitFor((): void => {
          expect(received).toEqual([
            { marker: 'before-unlisten', sequence: 1 },
            { marker: 'registered-again', sequence: 3 },
          ]);
        }, waitOptions);
      } finally {
        await observer.end();
        await control.end();
        await kit.destroy();
      }
    });

    it('restores the listener after pg_terminate_backend kills its connection', async (): Promise<void> => {
      const appName = 'tpk_it_notify_restore';
      const { kit } = createNotifyKit(settings!, appName);
      const control = await connectClient(settings!);
      const received: Array<INotifyPayload> = [];

      try {
        await kit.initDatabase();
        const channel = await kit.makeNotify<INotifyPayload>(
          {
            sql: 'LISTEN tpk_it_notify_restore',
            notifyCallback: (payload): void => {
              received.push(payload);
            },
          },
          restoreOptions
        );
        const listenerPids = await findListenerPids(control, appName);
        expect(listenerPids).toHaveLength(1);
        const [terminatedPid] = listenerPids;

        await expect(
          control.query<{ terminated: boolean }>(
            'SELECT pg_terminate_backend($1) AS terminated',
            [terminatedPid]
          )
        ).resolves.toMatchObject({ rows: [{ terminated: true }] });

        // A new backend runs LISTEN for the same channel.
        await vi.waitFor(async (): Promise<void> => {
          const restoredPids = await findListenerPids(control, appName);
          expect(restoredPids).toHaveLength(1);
          expect(restoredPids[0]).not.toBe(terminatedPid);
        }, waitOptions);

        // The restored listener is registered from the kit's side a moment
        // after the server has run LISTEN, so the notification is re-sent
        // until it arrives.
        let sequence = 0;
        await vi.waitFor(async (): Promise<void> => {
          sequence += 1;
          await sendNotification(control, channel, {
            marker: 'after-restore',
            sequence,
          });
          expect(received).toContainEqual(
            expect.objectContaining({ marker: 'after-restore' })
          );
        }, waitOptions);
        // One restored listener: no notification reaches the callback twice.
        const deliveredSequences = received.map(
          ({ sequence: delivered }) => delivered
        );
        expect(new Set(deliveredSequences).size).toBe(
          deliveredSequences.length
        );
      } finally {
        await control.end();
        await kit.destroy();
      }
    });

    it('destroy() during an active subscription resolves and removes the listener', async (): Promise<void> => {
      const appName = 'tpk_it_notify_destroy';
      const { kit, logger } = createNotifyKit(settings!, appName);
      const control = await connectClient(settings!);
      const received: Array<INotifyPayload> = [];
      let isDestroyed = false;

      try {
        await kit.initDatabase();
        const channel = await kit.makeNotify<INotifyPayload>({
          sql: 'LISTEN tpk_it_notify_destroy',
          notifyCallback: (payload): void => {
            received.push(payload);
          },
        });
        await sendNotification(control, channel, {
          marker: 'before-destroy',
          sequence: 1,
        });
        await vi.waitFor((): void => {
          expect(received).toHaveLength(1);
        }, waitOptions);
        expect(await findListenerPids(control, appName)).toHaveLength(1);

        await expect(kit.destroy()).resolves.toBeUndefined();
        isDestroyed = true;

        // Neither the listening connection nor the pool keeps a backend.
        await vi.waitFor(async (): Promise<void> => {
          expect(await findBackendPids(control, appName)).toEqual([]);
        }, waitOptions);
        expect(logger.error).not.toHaveBeenCalled();
      } finally {
        await control.end();
        if (!isDestroyed) await kit.destroy();
      }
    });

    it('reloads package metadata when db_object_event names the package', async (): Promise<void> => {
      await createDescribeValueV1(settings!);
      const { kit } = createNotifyKit(settings!, 'tpk_it_notify_package', {
        packages: [packageSchema],
        procedureObjectList: {
          describeValue: `${packageSchema}.describe_value`,
        },
        isNeedDynamicallyUpdatePackagesInfo: true,
      });
      const procedureName = `${packageSchema}.describe_value`;
      const refreshedRow: IDescribeValueRow = {
        result: 2,
        label: 'fresh',
        revision: 'v2',
      };

      try {
        await kit.initDatabase();
        const initialRow: IDescribeValueRow = { result: 1, revision: 'v1' };
        await expect(
          kit.call<IDescribeValueRow>(procedureName, { value: 1 })
        ).resolves.toEqual({
          rows: [initialRow],
          outBinds: { out_cursor: [initialRow] },
        });

        await replaceDescribeValueWithV2(settings!);

        // Without a notification the kit still binds the old signature.
        await expect(
          Promise.resolve().then(() =>
            kit.call<IDescribeValueRow>(procedureName, {
              value: 2,
              label: 'fresh',
            })
          )
        ).rejects.toThrow();

        await withPostgresClient(settings!, async (client) => {
          await sendNotification(client, packageChannel, {
            event: 'CREATE',
            object: packageSchema,
          });
        });

        await vi.waitFor(async (): Promise<void> => {
          await expect(
            kit.call<IDescribeValueRow>(procedureName, {
              value: 2,
              label: 'fresh',
            })
          ).resolves.toEqual({
            rows: [refreshedRow],
            outBinds: { out_cursor: [refreshedRow] },
          });
        }, waitOptions);
      } finally {
        await kit.destroy();
        await dropPackageSchema(settings!);
      }
    });
  }
);
