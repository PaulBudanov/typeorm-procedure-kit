import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import oracledb from 'oracledb';
import { describe, expect, it, vi } from 'vitest';

import { OracleNotify } from '../../src/adapters/oracle/oracle-notify.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

import type {
  IOracleNotifyMsg,
  TOracleNormilizeOptionsNotify,
} from '../../src/types/notification.types.js';

interface IRestoreNotificationSchedule {
  currentRetry: number;
  maxRetries: number;
  retryAfterMaxDelayMs: number;
  retryDelayMs: number;
}

type TRestoreSubscriptionCallback = (
  sqlCommand: string,
  channelName: string,
  notifyCallback: (args: unknown) => void | Promise<void>,
  options: TOracleNormilizeOptionsNotify
) => Promise<void>;

function invokeSubscriptionChange(
  notify: OracleNotify,
  client: oracledb.Connection,
  notifyCallback: (
    rows: Array<Record<string, unknown>>
  ) => void | Promise<void>,
  msg: IOracleNotifyMsg,
  sql = 'SELECT * FROM APP.TABLE_A'
): Promise<void> {
  const notifyWithHandler = notify as unknown as {
    makeSubscriptionHandler: (
      callback: (rows: Array<Record<string, unknown>>) => void | Promise<void>,
      connection: oracledb.Connection,
      channelName: string,
      options: Omit<oracledb.SubscribeOptions, 'callback'>,
      restoreOptions: TOracleNormilizeOptionsNotify,
      message: IOracleNotifyMsg
    ) => Promise<void>;
  };

  return notifyWithHandler.makeSubscriptionHandler(
    notifyCallback,
    client,
    'test-channel',
    { sql },
    {},
    msg
  );
}

describe('OracleNotify', (): void => {
  it(
    'rejects long malformed SQL without blocking the process',
    { timeout: 15_000 },
    async (): Promise<void> => {
      await expect(
        promisify(execFile)(
          process.execPath,
          [resolve('test/support/oracle-cqn-parser-child.mjs')],
          {
            timeout: 10_000,
          }
        )
      ).resolves.toMatchObject({ stderr: '' });
    }
  );

  it.each([
    'select\tID\nfrom\tAPP.TABLE_A\nAS t\nWHERE t.ID = 1',
    'SELECT ID FROM APP.TABLE_A t WHERE t.ID = 1',
  ])('preserves CQN query parts for %s', async (sql): Promise<void> => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const notify = new OracleNotify({} as never, createLogger());
    await invokeSubscriptionChange(
      notify,
      { execute } as never,
      vi.fn(),
      {
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [{ name: 'APP.TABLE_A', rows: [{ rowid: 'AAA' }] }],
      } as IOracleNotifyMsg,
      sql
    );
    expect(execute).toHaveBeenCalledWith(
      'SELECT ID FROM APP.TABLE_A t WHERE (t.ID = 1) AND t.ROWID IN (:rowid_0)',
      { rowid_0: 'AAA' },
      expect.objectContaining({ maxRows: 2 })
    );
  });

  it.each([
    "'it''s FROM somewhere' AS label",
    'EXTRACT(DAY FROM CREATED_AT) AS day_number',
    "TRIM(' ' FROM NAME) AS trimmed_name",
    "COALESCE(TRIM(' ' FROM NAME), 'unknown') AS name",
    "q'[it's FROM somewhere]' AS label",
    "Q'{it's FROM somewhere}' AS label",
    "q'<it's FROM somewhere>' AS label",
    "nq'(it's FROM somewhere)' AS label",
    "q'!it's FROM somewhere!' AS label",
    "q'🙂it's FROM somewhere🙂' AS label",
  ])(
    'preserves FROM inside projection %s',
    async (projection): Promise<void> => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const notify = new OracleNotify({} as never, createLogger());
      const sql = `SELECT ${projection} FROM APP.TABLE_A WHERE NAME = 'with spaces'`;
      await invokeSubscriptionChange(
        notify,
        { execute } as never,
        vi.fn(),
        {
          type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
          tables: [{ name: 'APP.TABLE_A', rows: [{ rowid: 'AAA' }] }],
        } as IOracleNotifyMsg,
        sql
      );
      expect(execute.mock.calls[0]?.[0]).toBe(
        `SELECT ${projection} FROM APP.TABLE_A WHERE (NAME = 'with spaces') AND ROWID IN (:rowid_0)`
      );
    }
  );

  it.each([
    '',
    'SELECT',
    'SELECT FROM APP.TABLE_A',
    'SELECT ID FROM',
    'SELECT ID FROM APP.TABLE_A AS',
    'SELECT ID FROM APP.TABLE_A WHERE',
    'SELECT ID FROM APP.TABLE_A AS WHERE ID = 1',
    'SELECT ID FROM A.B.C',
    "SELECT ID FROM APP.TABLE_A 'unfinished",
    'SELECT "unfinished FROM APP.TABLE_A',
    'SELECT EXTRACT(DAY FROM CREATED_AT FROM APP.TABLE_A',
    'SELECT ID) FROM APP.TABLE_A',
    "SELECT q'[unfinished FROM APP.TABLE_A",
    "SELECT q' unfinished ' FROM APP.TABLE_A",
    'SELECT ID FROM APP.TABLE_A;',
    'SELECT ID FROM APP.TABLE_A -- comment',
    'SELECT /* comment */ ID FROM APP.TABLE_A',
    'SELECT DISTINCT ID FROM APP.TABLE_A',
    'SELECT ID FROM APP.TABLE_A ORDER BY ID',
    'SELECT ID FROM APP.TABLE_A WHERE ID IN (SELECT ID FROM APP.TABLE_B)',
  ])(
    'rejects unsupported CQN SQL before acquiring resources: %j',
    async (sql): Promise<void> => {
      const createSingleConnection = vi.fn();
      const notify = new OracleNotify(
        { createSingleConnection } as never,
        createLogger()
      );
      await expect(notify.listenNotify(sql, vi.fn())).rejects.toThrow();
      expect(createSingleConnection).not.toHaveBeenCalled();
    }
  );

  it('builds package notification SQL with validated package names', (): void => {
    const notify = new OracleNotify({} as never, createLogger());

    expect(notify.getPackagesNotifySql(['pkg_one', 'pkgTwo'])).toContain(
      "NAME = 'PKG_ONE' OR NAME = 'PKGTWO'"
    );
    expect((): void => {
      notify.getPackagesNotifySql([]);
    }).toThrow('At least one package is required');
    expect((): void => {
      notify.getPackagesNotifySql(['pkg;drop']);
    }).toThrow('Unsafe SQL identifier');
  });

  it('keeps the default Oracle health-check interval', async (): Promise<void> => {
    const connection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValue(connection),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());
    const startConnectionHealthCheck = vi.fn();
    Reflect.set(
      notify,
      'startConnectionHealthCheck',
      startConnectionHealthCheck
    );

    await notify.listenNotify('SELECT * FROM table_name', vi.fn());

    expect(startConnectionHealthCheck).toHaveBeenCalledWith(
      expect.objectContaining({ intervalMs: 15_000 })
    );
  });

  it.each([
    {
      name: 'defaults',
      options: {},
      expected: {
        currentRetry: 1,
        maxRetries: 5,
        retryAfterMaxDelayMs: 1_800_000,
        retryDelayMs: 30_000,
      },
    },
    {
      name: 'custom overrides',
      options: {
        maxRetries: 7,
        retryAfterMaxDelayMs: 750,
        retryDelayMs: 250,
      },
      expected: {
        currentRetry: 1,
        maxRetries: 7,
        retryAfterMaxDelayMs: 750,
        retryDelayMs: 250,
      },
    },
  ] satisfies Array<{
    name: string;
    options: TOracleNormilizeOptionsNotify;
    expected: IRestoreNotificationSchedule;
  }>)(
    'keeps Oracle restore retry $name',
    async ({ options, expected }): Promise<void> => {
      const notify = new OracleNotify({} as never, createLogger());
      const restoreNotification = vi
        .fn<(_schedule: IRestoreNotificationSchedule) => Promise<void>>()
        .mockResolvedValue(undefined);
      Reflect.set(notify, 'restoreNotification', restoreNotification);
      const restoreSubscriptionCallback = Reflect.get(
        notify,
        'restoreSubscriptionCallback'
      ) as TRestoreSubscriptionCallback;

      await restoreSubscriptionCallback.call(
        notify,
        'SELECT * FROM table_name',
        'channel-name',
        vi.fn(),
        options
      );

      expect(restoreNotification).toHaveBeenCalledWith(
        expect.objectContaining(expected)
      );
    }
  );

  it('processes only the subscribed CQN table and deduplicates ROWIDs', async (): Promise<void> => {
    const execute = vi
      .fn<
        (
          sql: string,
          bindings: Record<string, string>
        ) => Promise<{ rows: Array<Record<string, unknown>> }>
      >()
      .mockImplementation(async (sql) => ({
        rows: [{ source: sql.includes('TABLE_A') ? 'a' : 'b' }],
      }));
    const callback = vi.fn<(rows: Array<Record<string, unknown>>) => void>();
    const notify = new OracleNotify({} as never, createLogger());

    await invokeSubscriptionChange(
      notify,
      { execute } as unknown as oracledb.Connection,
      callback,
      {
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [
          {
            name: 'APP.TABLE_A',
            rows: [{ rowid: 'AAA' }],
          },
        ],
        queries: [
          {
            tables: [
              {
                name: 'APP.TABLE_A',
                rows: [{ rowid: 'AAA' }, { rowid: 'AAA' }],
              },
            ],
          },
          {
            tables: [
              {
                name: 'APP.TABLE_B',
                rows: [{ rowid: 'BBB' }],
              },
            ],
          },
        ],
      } as IOracleNotifyMsg
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBe(
      'SELECT * FROM APP.TABLE_A WHERE ROWID IN (:rowid_0)'
    );
    expect(execute.mock.calls[0]?.[1]).toEqual({ rowid_0: 'AAA' });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('preserves the subscription projection, alias, and predicate when refetching ROWIDs', async (): Promise<void> => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ NAME: 'PKG' }] });
    const callback = vi.fn();
    const notify = new OracleNotify({} as never, createLogger());

    await invokeSubscriptionChange(
      notify,
      { execute } as unknown as oracledb.Connection,
      callback,
      {
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [
          { name: 'SOLUTION_ROOT.DB_OBJECT_LOG', rows: [{ rowid: 'AAA' }] },
        ],
      } as IOracleNotifyMsg,
      "SELECT NAME FROM SOLUTION_ROOT.DB_OBJECT_LOG t WHERE ACTION='REPLACE' AND TYPE='PACKAGE'"
    );

    expect(execute).toHaveBeenCalledWith(
      "SELECT NAME FROM SOLUTION_ROOT.DB_OBJECT_LOG t WHERE (ACTION='REPLACE' AND TYPE='PACKAGE') AND t.ROWID IN (:rowid_0)",
      { rowid_0: 'AAA' },
      expect.objectContaining({ maxRows: 2 })
    );
    expect(callback).toHaveBeenCalledWith([{ NAME: 'PKG' }]);
  });

  it('skips rowless CQN events instead of running a full-table refresh', async (): Promise<void> => {
    const execute = vi
      .fn<(sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>>()
      .mockResolvedValue({ rows: [{ id: 1 }] });
    const callback = vi.fn<(rows: Array<Record<string, unknown>>) => void>();
    const notify = new OracleNotify({} as never, createLogger());

    await invokeSubscriptionChange(
      notify,
      { execute } as unknown as oracledb.Connection,
      callback,
      {
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [{ name: 'APP.PACKAGE_LOG' }, { name: 'APP.PACKAGE_LOG' }],
      } as IOracleNotifyMsg
    );

    expect(execute).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('chunks large CQN ROWID lists and binds every ROWID', async (): Promise<void> => {
    const execute = vi
      .fn<
        (
          sql: string,
          bindings: Record<string, string>
        ) => Promise<{ rows: Array<Record<string, unknown>> }>
      >()
      .mockResolvedValue({ rows: [] });
    const callback = vi.fn<(rows: Array<Record<string, unknown>>) => void>();
    const notify = new OracleNotify({} as never, createLogger());
    const rowIds = Array.from({ length: 1_001 }, (_, index) => ({
      rowid: `RID${index}`,
    }));

    await invokeSubscriptionChange(
      notify,
      { execute } as unknown as oracledb.Connection,
      callback,
      {
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [{ name: 'APP.TABLE_A', rows: rowIds }],
      } as IOracleNotifyMsg
    );

    expect(execute).toHaveBeenCalledTimes(2);
    expect(Object.keys(execute.mock.calls[0]?.[1] ?? {})).toHaveLength(1_000);
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      rowid_0: 'RID0',
      rowid_999: 'RID999',
    });
    expect(execute.mock.calls[1]?.[1]).toEqual({ rowid_0: 'RID1000' });
    expect(execute.mock.calls[0]?.[0]).not.toContain('RID0');
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('drops an oversized CQN event before issuing a query', async (): Promise<void> => {
    const execute = vi.fn();
    const callback = vi.fn();
    const logger = createLogger();
    const notify = new OracleNotify({} as never, logger, 10, 2);

    await invokeSubscriptionChange(
      notify,
      { execute } as unknown as oracledb.Connection,
      callback,
      {
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [
          {
            name: 'APP.TABLE_A',
            rows: [{ rowid: 'AAA' }, { rowid: 'BBB' }, { rowid: 'CCC' }],
          },
        ],
      } as IOracleNotifyMsg
    );

    expect(execute).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('maxNotificationRows (2)')
    );
  });

  it('rejects CQN joins before creating a connection', async (): Promise<void> => {
    const oracleConnection = {
      createSingleConnection: vi.fn(),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    await expect(
      notify.listenNotify(
        'SELECT a.ID FROM APP.TABLE_A a JOIN APP.TABLE_B b ON b.ID = a.ID',
        vi.fn()
      )
    ).rejects.toThrow('simple single-table SELECT');
    expect(oracleConnection.createSingleConnection).not.toHaveBeenCalled();
  });

  it('rejects an empty operations array before creating a connection', async (): Promise<void> => {
    const oracleConnection = {
      createSingleConnection: vi.fn(),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    await expect(
      notify.listenNotify('SELECT ID FROM APP.TABLE_A', vi.fn(), {
        operations: [],
      })
    ).rejects.toThrow(
      'Oracle notification operations must contain at least one operation'
    );
    expect(oracleConnection.createSingleConnection).not.toHaveBeenCalled();
  });

  it('uses the default operation and preserves a nonempty operation array', async (): Promise<void> => {
    const subscriptions: Array<oracledb.SubscribeOptions> = [];
    const defaultConnection = {
      subscribe: vi.fn(
        async (
          _channel: string,
          options: oracledb.SubscribeOptions
        ): Promise<void> => {
          subscriptions.push(options);
        }
      ),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const specificConnection = {
      subscribe: vi.fn(
        async (
          _channel: string,
          options: oracledb.SubscribeOptions
        ): Promise<void> => {
          subscriptions.push(options);
        }
      ),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn()
        .mockResolvedValueOnce(defaultConnection)
        .mockResolvedValueOnce(specificConnection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    await notify.listenNotify('SELECT ID FROM APP.TABLE_A', vi.fn());
    await notify.listenNotify('SELECT ID FROM APP.TABLE_A', vi.fn(), {
      operations: [oracledb.CQN_OPCODE_INSERT],
    });

    expect(subscriptions.map(({ operations }) => operations)).toEqual([
      oracledb.CQN_OPCODE_ALL_OPS,
      oracledb.CQN_OPCODE_INSERT,
    ]);
    await notify.destroy();
  });

  it('serializes CQN work per subscription connection', async (): Promise<void> => {
    let callback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let releaseFirst!: () => void;
    const firstExecute = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let activeExecutions = 0;
    let maxActiveExecutions = 0;
    const connection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          callback = options.callback;
          return Promise.resolve();
        }),
      execute: vi.fn().mockImplementation(async () => {
        activeExecutions += 1;
        maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
        if (connection.execute.mock.calls.length === 1) await firstExecute;
        activeExecutions -= 1;
        return { rows: [] };
      }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi.fn().mockResolvedValue(connection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
    };
    const logger = createLogger();
    const notify = new OracleNotify(oracleConnection as never, logger, 2);
    const channel = await notify.listenNotify(
      'SELECT ID FROM APP.TABLE_A',
      vi.fn()
    );
    const message = {
      type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
      tables: [{ name: 'APP.TABLE_A', rows: [{ rowid: 'AAA' }] }],
    } as unknown as oracledb.SubscriptionMessage;

    const first = callback?.(message);
    const second = callback?.(message);
    const dropped = callback?.(message);
    await vi.waitFor(() => expect(connection.execute).toHaveBeenCalledOnce());
    releaseFirst();
    await Promise.all([first, second, dropped]);

    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(maxActiveExecutions).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('notification queue limit (2)')
    );
    await notify.unlistenNotify(channel);
  });

  it('drains active and queued CQN callbacks before destroy and rejects new events while closing', async (): Promise<void> => {
    let driverCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let releaseFirst!: () => void;
    const firstCallback = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const userCallback = vi.fn(async () => {
      if (userCallback.mock.calls.length === 1) await firstCallback;
    });
    const connection = {
      subscribe: vi.fn(
        async (_channel: string, options: oracledb.SubscribeOptions) => {
          driverCallback = options.callback;
        }
      ),
      execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi.fn().mockResolvedValue(connection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());
    await notify.listenNotify('SELECT ID FROM APP.TABLE_A', userCallback);
    const message = {
      type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
      tables: [{ name: 'APP.TABLE_A', rows: [{ rowid: 'AAA' }] }],
    } as unknown as oracledb.SubscriptionMessage;

    const first = driverCallback?.(message);
    const second = driverCallback?.(message);
    await vi.waitFor(() => expect(userCallback).toHaveBeenCalledOnce());

    const destroyPromise = notify.destroy();
    const dropped = driverCallback?.(message);
    await dropped;
    expect(oracleConnection.closeSingleConnection).not.toHaveBeenCalled();
    expect(connection.execute).toHaveBeenCalledOnce();

    releaseFirst();
    await Promise.all([first, second, destroyPromise]);

    expect(userCallback).toHaveBeenCalledTimes(2);
    expect(connection.execute).toHaveBeenCalledTimes(2);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
  });

  it('times out a hung CQN callback and keeps destroy idempotent', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      let driverCallback:
        | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
        | undefined;
      const connection = {
        subscribe: vi.fn(
          async (_channel: string, options: oracledb.SubscribeOptions) => {
            driverCallback = options.callback;
          }
        ),
        execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      };
      const oracleConnection = {
        createSingleConnection: vi.fn().mockResolvedValue(connection),
        isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
        closeSingleConnection: vi.fn().mockResolvedValue(undefined),
      };
      const logger = createLogger();
      const notify = new OracleNotify(oracleConnection as never, logger);
      await notify.listenNotify(
        'SELECT ID FROM APP.TABLE_A',
        () => new Promise<void>(() => undefined)
      );
      void driverCallback?.({
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [{ name: 'APP.TABLE_A', rows: [{ rowid: 'AAA' }] }],
      } as unknown as oracledb.SubscriptionMessage);
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
      expect(connection.execute).toHaveBeenCalledOnce();

      const firstDestroy = notify.destroy();
      expect(notify.destroy()).toBe(firstDestroy);
      expect(oracleConnection.closeSingleConnection).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      await firstDestroy;

      expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
        connection
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Timed out waiting 5000ms for notification callbacks on channel'
        )
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('unsubscribes a channel and closes its connection', async (): Promise<void> => {
    const connection = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    notify.getNotificationPool().set('channel', connection as never);

    await notify.unlistenNotify('channel');

    expect(connection.unsubscribe).toHaveBeenCalledWith('channel');
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
  });

  it('unsubscribes each operation subscription and closes connections', async (): Promise<void> => {
    const connectionA = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const connectionB = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    notify.getNotificationPool().set('a', connectionA as never);
    notify.getNotificationPool().set('b', connectionB as never);

    await notify.unlistenNotify('a, b');

    expect(connectionA.unsubscribe).toHaveBeenCalledWith('a');
    expect(connectionB.unsubscribe).toHaveBeenCalledWith('b');
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledTimes(2);
  });

  it('closes the connection even when unsubscribe fails', async (): Promise<void> => {
    const error = new Error('NJS-003: invalid or closed connection');
    const connection = {
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockRejectedValue(error),
    };
    const oracleConnection = {
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    notify.getNotificationPool().set('channel', connection as never);
    await notify.unlistenNotify('channel');

    expect(connection.unsubscribe).toHaveBeenCalledWith('channel');
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
  });

  it('cleans up registered operation subscriptions when batch registration fails', async (): Promise<void> => {
    const firstConnection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockResolvedValue(undefined),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockRejectedValue(new Error('subscribe failed')),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    await expect(
      notify.listenNotify('SELECT * FROM table_name', vi.fn(), {
        operations: [1, 2],
      })
    ).rejects.toThrow('subscribe failed');

    expect(firstConnection.unsubscribe).toHaveBeenCalledTimes(1);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('rejects registration after destroy without creating a connection', async (): Promise<void> => {
    const oracleConnection = {
      createSingleConnection: vi.fn(),
      closeSingleConnection: vi.fn(),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    await notify.destroy();

    await expect(
      notify.listenNotify('SELECT * FROM table_name', vi.fn())
    ).rejects.toThrow('Database notification adapter is shutting down');
    expect(oracleConnection.createSingleConnection).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('closes a connection when destroy races with subscription registration', async (): Promise<void> => {
    let resolveSubscribe!: () => void;
    let subscribeStarted!: () => void;
    const subscribePromise = new Promise<void>((resolve) => {
      resolveSubscribe = resolve;
    });
    const subscribeStartedPromise = new Promise<void>((resolve) => {
      subscribeStarted = resolve;
    });
    const connection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockImplementation(() => {
          subscribeStarted();
          return subscribePromise;
        }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValue(connection),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const registration = notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn()
    );
    await subscribeStartedPromise;
    let isDestroySettled = false;
    const destroy = notify.destroy().then(() => {
      isDestroySettled = true;
    });
    await Promise.resolve();

    expect(isDestroySettled).toBe(false);
    expect(oracleConnection.closeSingleConnection).not.toHaveBeenCalled();
    resolveSubscribe();

    await expect(registration).rejects.toThrow(
      'Database notification adapter is shutting down'
    );
    await destroy;
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledOnce();
    expect(connection.unsubscribe).toHaveBeenCalledWith(
      connection.subscribe.mock.calls[0]?.[0]
    );
    expect(connection.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      oracleConnection.closeSingleConnection.mock.invocationCallOrder[0]!
    );
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('times out a pending subscription without publishing it after shutdown', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      let resolveSubscribe!: () => void;
      const pendingSubscribe = new Promise<void>((resolve) => {
        resolveSubscribe = resolve;
      });
      const connection = {
        subscribe: vi.fn().mockReturnValue(pendingSubscribe),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      };
      const oracleConnection = {
        createSingleConnection: vi.fn().mockResolvedValue(connection),
        closeSingleConnection: vi.fn().mockResolvedValue(undefined),
      };
      const logger = createLogger();
      const notify = new OracleNotify(oracleConnection as never, logger);

      const registration = notify.listenNotify(
        'SELECT * FROM table_name',
        vi.fn()
      );
      await vi.waitFor(() => expect(connection.subscribe).toHaveBeenCalled());
      const destroy = notify.destroy();
      await vi.advanceTimersByTimeAsync(5_000);
      await destroy;

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Timed out waiting 5000ms for notification registration'
        )
      );
      expect(notify.getNotificationPool().size).toBe(0);

      resolveSubscribe();
      await expect(registration).rejects.toThrow(
        'Database notification adapter is shutting down'
      );
      expect(oracleConnection.closeSingleConnection).toHaveBeenCalledOnce();
      expect(connection.unsubscribe).toHaveBeenCalledOnce();
      expect(notify.getNotificationPool().size).toBe(0);
      await notify.destroy();
      expect(oracleConnection.closeSingleConnection).toHaveBeenCalledOnce();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps the shutdown error and unsubscribe failure while still closing the connection', async (): Promise<void> => {
    let completeSubscribe!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      completeSubscribe = resolve;
    });
    const unsubscribeError = new Error('unsubscribe failed');
    const connection = {
      subscribe: vi.fn().mockImplementation(() => {
        markStarted();
        return pending;
      }),
      unsubscribe: vi.fn().mockRejectedValue(unsubscribeError),
    };
    const oracleConnection = {
      createSingleConnection: vi.fn().mockResolvedValue(connection),
      closeSingleConnection: vi.fn().mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());
    const registration = notify
      .listenNotify('SELECT * FROM table_name', vi.fn())
      .catch((error: unknown) => error);
    await started;
    const destruction = notify.destroy();
    completeSubscribe();
    const error = await registration;
    await destruction;
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error('Expected aggregate cleanup failure');
    expect(error.cause).toBeInstanceOf(ServerError);
    expect(error.cause).toHaveProperty(
      'message',
      'Database notification adapter is shutting down'
    );
    expect(error.errors).toEqual([error.cause, unsubscribeError]);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledOnce();
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('cleans published subscription state when registration finalization fails', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const registrationError = new Error('registration finalization failed');
      const connection = {
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      };
      const oracleConnection = {
        createSingleConnection: vi.fn().mockResolvedValue(connection),
        closeSingleConnection: vi.fn().mockResolvedValue(undefined),
        isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      };
      const logger = createLogger();
      logger.log.mockImplementation((message: unknown) => {
        if (
          typeof message === 'string' &&
          message.startsWith('Successfully registered subscription')
        )
          throw registrationError;
      });
      const notify = new OracleNotify(oracleConnection as never, logger);
      await expect(
        notify.listenNotify('SELECT * FROM table_name', vi.fn())
      ).rejects.toBe(registrationError);
      expect(connection.unsubscribe).toHaveBeenCalledOnce();
      expect(oracleConnection.closeSingleConnection).toHaveBeenCalledOnce();
      expect(notify.getNotificationPool().size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await notify.destroy();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not keep a restored subscription when manual unlisten races with resubscribe', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let resolveSecondSubscribe!: () => void;
    let secondSubscribeStarted!: () => void;
    const secondSubscribePromise = new Promise<void>((resolve) => {
      resolveSecondSubscribe = resolve;
    });
    const secondSubscribeStartedPromise = new Promise<void>((resolve) => {
      secondSubscribeStarted = resolve;
    });
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            _options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation(() => {
          secondSubscribeStarted();
          return secondSubscribePromise;
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    void capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    await secondSubscribeStartedPromise;

    const unlistenPromise = notify.unlistenNotify(channelName);
    await Promise.resolve();
    expect(oracleConnection.closeSingleConnection).not.toHaveBeenCalledWith(
      secondConnection
    );
    resolveSecondSubscribe();
    await unlistenPromise;
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(firstConnection.unsubscribe).toHaveBeenCalledWith(channelName);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    await vi.waitFor(() => {
      expect(notify.getNotificationPool().has(channelName)).toBe(false);
    });
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
  });

  it('waits for an in-flight restore and closes the restored subscription during destroy', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let resolveSecondSubscribe!: () => void;
    let secondSubscribeStarted!: () => void;
    const secondSubscribePromise = new Promise<void>((resolve) => {
      resolveSecondSubscribe = resolve;
    });
    const secondSubscribeStartedPromise = new Promise<void>((resolve) => {
      secondSubscribeStarted = resolve;
    });
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            _options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation(() => {
          secondSubscribeStarted();
          return secondSubscribePromise;
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    void capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    await secondSubscribeStartedPromise;

    let isDestroySettled = false;
    const destroyPromise = notify.destroy().then(() => {
      isDestroySettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(isDestroySettled).toBe(false);

    resolveSecondSubscribe();
    await destroyPromise;

    expect(notify.getNotificationPool().has(channelName)).toBe(false);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
  });

  it('keeps a successfully restored subscription under the same channel', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            _options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    await capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    await vi.waitFor(() => {
      expect(notify.getNotificationPool().get(channelName)).toBe(
        secondConnection
      );
    });
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      firstConnection
    );
    expect(oracleConnection.closeSingleConnection).not.toHaveBeenCalledWith(
      secondConnection
    );
  });

  it('preserves server-initiated CQN port when restoring a subscription', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let restoredOptions: oracledb.SubscribeOptions | undefined;
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          restoredOptions = options;
          return Promise.resolve();
        }),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {
        clientInitiated: false,
        cqnPort: 12345,
      }
    );
    await capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);

    await vi.waitFor(() => {
      expect(notify.getNotificationPool().get(channelName)).toBe(
        secondConnection
      );
    });
    expect(restoredOptions?.clientInitiated).toBe(false);
    expect(restoredOptions?.port).toBe(12345);
  });

  it('ignores stale restore callbacks after manual unlisten', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    const connection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValue(connection),
      isSingleConnectionHealthy: vi
        .fn<(_connection: object, _timeoutMs?: number) => Promise<boolean>>()
        .mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    await notify.unlistenNotify(channelName);
    await capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);

    expect(oracleConnection.createSingleConnection).toHaveBeenCalledTimes(1);
    expect(notify.getNotificationPool().has(channelName)).toBe(false);
  });

  it('closes the connection it opened when building the subscribe options throws', async (): Promise<void> => {
    const connection = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValue(connection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());
    // listenNotify never reads qos itself, so the first read of this accessor
    // happens while the subscribe options are built - after the connection
    // has been opened.
    const options = {
      get qos(): number {
        throw new Error('qos is not configured');
      },
    };

    await expect(
      notify.listenNotify('SELECT ID FROM APP.TABLE_A', vi.fn(), options)
    ).rejects.toThrow('qos is not configured');

    expect(oracleConnection.createSingleConnection).toHaveBeenCalledOnce();
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledOnce();
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      connection
    );
    expect(connection.subscribe).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('leaves no connection open when per-operation options cannot be built', async (): Promise<void> => {
    const connection = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValue(connection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());
    const options = {
      operations: [oracledb.CQN_OPCODE_INSERT, oracledb.CQN_OPCODE_UPDATE],
      get qos(): number {
        throw new Error('qos is not configured');
      },
    };

    await expect(
      notify.listenNotify('SELECT ID FROM APP.TABLE_A', vi.fn(), options)
    ).rejects.toThrow('qos is not configured');

    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledTimes(
      oracleConnection.createSingleConnection.mock.calls.length
    );
    expect(connection.subscribe).not.toHaveBeenCalled();
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('closes the connection of a failed restore attempt exactly once', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi.fn().mockRejectedValue(new Error('ORA-29970')),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const logger = createLogger();
    const notify = new OracleNotify(oracleConnection as never, logger);

    await notify.listenNotify('SELECT * FROM table_name', vi.fn(), {});
    void capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Attempt 1/5 failed to restore'),
        expect.any(String)
      );
    });
    await notify.destroy();

    const secondConnectionCloses =
      oracleConnection.closeSingleConnection.mock.calls.filter(
        ([connection]) => connection === secondConnection
      );
    expect(secondConnectionCloses).toHaveLength(1);
  });

  it('restores under the name the caller holds when closing the lost subscription fails', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi
        .fn<(_channel: string, _options: object) => Promise<void>>()
        .mockResolvedValue(undefined),
      unsubscribe: vi
        .fn<(_channel: string) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockImplementation((connection) =>
          connection === firstConnection
            ? Promise.reject(new Error('NJS-500: connection lost'))
            : Promise.resolve()
        ),
    };
    const logger = createLogger();
    const notify = new OracleNotify(oracleConnection as never, logger);

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    await capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);

    expect(secondConnection.subscribe).toHaveBeenCalledWith(
      channelName,
      expect.anything()
    );
    expect(Array.from(notify.getNotificationPool().entries())).toEqual([
      [channelName, secondConnection],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('NJS-500: connection lost')
    );

    await notify.unlistenNotify(channelName);

    expect(secondConnection.unsubscribe).toHaveBeenCalledWith(channelName);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
    expect(notify.getNotificationPool().size).toBe(0);
  });

  it('honours an unlisten issued while a restore that could not close the lost subscription resubscribes', async (): Promise<void> => {
    let capturedCallback:
      | ((message: oracledb.SubscriptionMessage) => void | Promise<void>)
      | undefined;
    let resolveSecondSubscribe!: () => void;
    let secondSubscribeStarted!: () => void;
    const secondSubscribePromise = new Promise<void>((resolve) => {
      resolveSecondSubscribe = resolve;
    });
    const secondSubscribeStartedPromise = new Promise<void>((resolve) => {
      secondSubscribeStarted = resolve;
    });
    const firstConnection = {
      subscribe: vi
        .fn<
          (
            _channel: string,
            options: oracledb.SubscribeOptions
          ) => Promise<void>
        >()
        .mockImplementation((_channel, options) => {
          capturedCallback = options.callback;
          return Promise.resolve();
        }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const secondConnection = {
      subscribe: vi.fn().mockImplementation(() => {
        secondSubscribeStarted();
        return secondSubscribePromise;
      }),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    const oracleConnection = {
      createSingleConnection: vi
        .fn<() => Promise<object>>()
        .mockResolvedValueOnce(firstConnection)
        .mockResolvedValueOnce(secondConnection),
      isSingleConnectionHealthy: vi.fn().mockResolvedValue(true),
      closeSingleConnection: vi
        .fn<(_connection: object) => Promise<void>>()
        .mockImplementation((connection) =>
          connection === firstConnection
            ? Promise.reject(new Error('NJS-500: connection lost'))
            : Promise.resolve()
        ),
    };
    const notify = new OracleNotify(oracleConnection as never, createLogger());

    const channelName = await notify.listenNotify(
      'SELECT * FROM table_name',
      vi.fn(),
      {}
    );
    const restore = capturedCallback?.({
      type: oracledb.SUBSCR_EVENT_TYPE_DEREG,
      registered: false,
    } as oracledb.SubscriptionMessage);
    await secondSubscribeStartedPromise;

    const unlisten = notify.unlistenNotify(channelName);
    await Promise.resolve();
    resolveSecondSubscribe();
    await unlisten;
    await restore;

    expect(notify.getNotificationPool().size).toBe(0);
    expect(oracleConnection.closeSingleConnection).toHaveBeenCalledWith(
      secondConnection
    );
  });

  it('passes refetched rows to the callback even when the first row looks like an error envelope', async (): Promise<void> => {
    const rows = [
      { error_code: 1, error_text: 'job failed', job_id: 1 },
      { error_code: 0, error_text: null, job_id: 2 },
    ];
    const execute = vi.fn().mockResolvedValue({ rows });
    const callback = vi.fn<(rows: Array<Record<string, unknown>>) => void>();
    const logger = createLogger();
    const notify = new OracleNotify({} as never, logger);

    await invokeSubscriptionChange(
      notify,
      { execute } as never,
      callback,
      {
        type: oracledb.SUBSCR_EVENT_TYPE_OBJ_CHANGE,
        tables: [
          {
            name: 'APP.JOB_LOG',
            rows: [{ rowid: 'AAA' }, { rowid: 'AAB' }],
          },
        ],
      } as IOracleNotifyMsg,
      'SELECT error_code "error_code", error_text "error_text", job_id "job_id" FROM APP.JOB_LOG'
    );

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith([
      { error_code: 1, error_text: 'job failed', job_id: 1 },
      { error_code: 0, error_text: null, job_id: 2 },
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
