import { describe, expect, it, vi } from 'vitest';

import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { SHUTDOWN_SIGNALS } from '../../src/consts/shutdown.consts.js';
import { TypeOrmProcedureKit } from '../../src/core/index.js';
import { NotifyBase } from '../../src/core/notify-base.js';
import { QueryLogContextStorage } from '../../src/utils/query-log-context.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createAdapterMock, createLogger } from '../support/helpers.js';

import type { IErrorEnvelopeKeys } from '../../src/index.js';
import type { EntityManager } from '../../src/typeorm/entity-manager/EntityManager.js';
import type { TPostgresDbConfig } from '../../src/types/config.types.js';
import type {
  TSerializerInput,
  TSerializerType,
  TSetSerializer,
} from '../../src/types/serializer.types.js';
import type { ITestLogger } from '../support/helpers.js';

const SHUTDOWN_ERROR = 'TypeOrmProcedureKit is shutting down or destroyed';
const NOT_INITIALIZED_ERROR = /^TypeOrmProcedureKit is not initialized$/;
const NOT_INITIALIZED_MESSAGE = 'TypeOrmProcedureKit is not initialized';
const PACKAGES_NOT_CONFIGURED_MESSAGE =
  'Procedure packages are not configured. Set config.packagesSettings before calling procedures.';
const CHANGE_NOTIFICATIONS_UNSUPPORTED_WARNING =
  'Dynamic package metadata refresh is switched off: Oracle change notifications require node-oracledb Thick mode (set libraryPath, or call oracledb.initOracleClient() before initDatabase()) and the CHANGE NOTIFICATION privilege. Package metadata is loaded once and is not refreshed when packages change.';

function createKit(
  logger: ITestLogger = createLogger(),
  packagesSettings?: TPostgresDbConfig['packagesSettings']
): TypeOrmProcedureKit {
  return new TypeOrmProcedureKit({
    config: {
      type: 'postgres',
      master: {
        host: 'localhost',
        port: 5432,
        database: 'db',
        username: 'user',
        password: 'pass',
      },
      poolSize: 1,
      parseInt8AsNumber: false,
      packagesSettings,
    },
    logger: { module: logger },
  });
}

/**
 * Calls a promise-returning kit method and asserts that it reports `message` by rejecting the
 * promise it returns, not by throwing synchronously. The rejection handler is attached in the same
 * tick as the call, so the rejection is never reported as unhandled.
 * @param invoke - calls the method under test.
 * @param message - the full error message the promise must reject with.
 */
async function expectRejectionWithoutThrow(
  invoke: () => Promise<unknown>,
  message: string
): Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  expect((): void => {
    pending = invoke();
  }).not.toThrow();
  await expect(pending).rejects.toThrow(message);
}

/** The six promise-returning runtime methods, each called with valid arguments. */
const RUNTIME_PROMISE_METHODS: Array<
  [name: string, invoke: (kit: TypeOrmProcedureKit) => Promise<unknown>]
> = [
  ['call', (kit) => kit.call('pkg.run')],
  ['callSqlTransaction', (kit) => kit.callSqlTransaction('SELECT 1')],
  [
    'makeNotify',
    (kit) => kit.makeNotify({ sql: 'LISTEN manual', notifyCallback: vi.fn() }),
  ],
  ['unlistenNotify', (kit) => kit.unlistenNotify('manual')],
  ['getEntityManager', (kit) => kit.getEntityManager('master')],
  [
    'releaseEntityManager',
    (kit) => kit.releaseEntityManager({} as EntityManager),
  ],
];

/**
 * Builds a kit wired to a real PostgreSQL adapter, so that payload and placeholder errors come
 * from the adapter's own validation; only metadata loading and execution are stubbed.
 * @returns the kit and its execution stubs.
 */
function createKitWithRealBindings(): {
  kit: TypeOrmProcedureKit;
  execute: ReturnType<typeof vi.fn>;
  executeProcedure: ReturnType<typeof vi.fn>;
} {
  const adapter = new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
    createLogger(),
    {
      isNeedRegisterDefaultSerializers: false,
      caseStrategy: {
        transformColumnName: (value: string): string => value,
      },
    }
  );
  const kit = createKit(createLogger(), {
    packages: ['pkg'],
    procedureObjectList: { run: 'pkg.run' },
  });
  const execute = vi.fn();
  const executeProcedure = vi.fn();
  Object.assign(kit as unknown as Record<string, unknown>, {
    databaseInitializerBase: { databaseAdapter: adapter },
    procedureListBase: {
      packagesWithProceduresList: new Map([
        [
          'pkg',
          {
            run: [
              {
                argumentName: 'p_id',
                argumentType: 'integer',
                order: 1,
                mode: 'IN',
              },
            ],
          },
        ],
      ]),
      parseProcedureName: vi.fn(() => ({
        packageName: 'pkg',
        processName: 'run',
      })),
    },
    executeBase: { execute, executeProcedure },
  });
  return { kit, execute, executeProcedure };
}

interface IMetadataNotificationOptions {
  sql: string;
  notifyCallback: (args: unknown) => unknown;
}

function createMetadataNotificationHarness(
  metadataNotificationSql: string | undefined
): {
  kit: TypeOrmProcedureKit;
  getPackagesNotifySql: ReturnType<typeof vi.fn<() => string>>;
  createNotification: ReturnType<
    typeof vi.fn<(options: IMetadataNotificationOptions) => Promise<string>>
  >;
} {
  const kit = new TypeOrmProcedureKit({
    config: {
      type: 'postgres',
      master: {
        host: 'localhost',
        port: 5432,
        database: 'db',
        username: 'user',
        password: 'pass',
      },
      poolSize: 1,
      parseInt8AsNumber: false,
      packagesSettings: {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
        isNeedDynamicallyUpdatePackagesInfo: true,
        metadataNotificationSql,
      },
    },
    logger: { module: createLogger() },
  });
  const getPackagesNotifySql = vi.fn((): string => 'LISTEN "fallback"');
  const createNotification = vi
    .fn<(options: IMetadataNotificationOptions) => Promise<string>>()
    .mockResolvedValue('package_updates');

  Reflect.set(kit, 'databaseInitializerBase', {
    initDatabaseModule: vi.fn().mockResolvedValue(undefined),
    databaseAdapter: {
      getPackagesNotifySql,
      isChangeNotificationSupported: vi.fn((): boolean => true),
    },
  });
  Reflect.set(kit, 'initMainClasses', (): void => {
    Reflect.set(kit, 'procedureListBase', {
      initPackagesMap: vi.fn().mockResolvedValue(undefined),
    });
    Reflect.set(kit, 'notifyBase', {
      createNotification,
      schedulePackageNotifyCallback: vi.fn(),
    });
  });

  return { kit, getPackagesNotifySql, createNotification };
}

describe('TypeOrmProcedureKit', (): void => {
  it('reports useful errors before initialization', async (): Promise<void> => {
    const kit = createKit();

    await expectRejectionWithoutThrow(
      () => kit.call('pkg.run'),
      PACKAGES_NOT_CONFIGURED_MESSAGE
    );
    expect((): void => {
      kit.setSerializer({
        serializerType: 'DATE',
        strategy: ({ value }): string => value.toString(),
      });
    }).toThrow(ServerError);
    expect((): void => {
      void kit.serializerReadOnlyMapping;
    }).toThrow(ServerError);
  });

  it('reports the kit, not the initializer, as uninitialized from every serializer method', (): void => {
    // Before initDatabase() the initializer has no adapter, and its own getter would answer
    // `Database adapter is not initialized`. The serializer methods answer like the rest of the
    // runtime API instead.
    const kit = createKit();
    const strategy = ({ value }: TSerializerInput<'DATE'>): string =>
      value.toString();

    expect((): void => {
      kit.setSerializer({ serializerType: 'DATE', strategy });
    }).toThrow(NOT_INITIALIZED_ERROR);
    expect((): void => {
      kit.deleteSerializer({ serializerType: 'DATE' });
    }).toThrow(NOT_INITIALIZED_ERROR);
    expect((): void => {
      kit.deleteAllSerializers();
    }).toThrow(NOT_INITIALIZED_ERROR);
    expect((): void => {
      void kit.serializerReadOnlyMapping;
    }).toThrow(NOT_INITIALIZED_ERROR);
  });

  it('serves one read-only registry snapshot from the real adapter chain', async (): Promise<void> => {
    // A real adapter rather than a mock: the read-only guarantee and the argument checks live in
    // DatabaseSerializer, so a mock handing over an arbitrary Map would only test the mock. The kit
    // goes through its own initDatabase() and initMainClasses(); only the connection is stubbed.
    const adapter = new PostgreAdapter(
      { options: { replication: { master: {} } } } as never,
      createLogger(),
      {
        isNeedRegisterDefaultSerializers: false,
        caseStrategy: {
          transformColumnName: (value: string): string => value.toLowerCase(),
        },
      }
    );
    const kit = createKit();
    Reflect.set(kit, 'databaseInitializerBase', {
      initDatabaseModule: vi.fn().mockResolvedValue(undefined),
      appDataSource: {},
      databaseAdapter: adapter,
      resolvedResourceLimits: { maxMetadataRows: 1 },
    });
    await kit.initDatabase();

    const strategy = vi.fn((): string => 'date');
    kit.setSerializer({ serializerType: 'DATE', strategy });

    const readOnly = kit.serializerReadOnlyMapping;
    const mutationAttempt = readOnly as unknown as Map<
      TSerializerType,
      TSetSerializer
    >;

    expect(kit.serializerReadOnlyMapping).toBe(readOnly);
    expect(readOnly).toBe(adapter.serializerMapping);
    expect(readOnly.get('DATE')?.strategy).toBe(strategy);
    expect(typeof mutationAttempt.set).toBe('function');
    expect((): void => {
      mutationAttempt.set('TIMESTAMP', {
        serializerType: 'TIMESTAMP',
        strategy: vi.fn(),
      });
    }).toThrow(ServerError);
    expect((): void => {
      mutationAttempt.delete('DATE');
    }).toThrow(ServerError);
    expect(kit.serializerReadOnlyMapping.has('DATE')).toBe(true);

    expect((): void => {
      kit.setSerializer({
        serializerType: 'TIMESTAMP',
        strategy: 'not a function',
      } as unknown as TSetSerializer);
    }).toThrow('Serializer strategy for TIMESTAMP must be a function');
    expect((): void => {
      kit.deleteSerializer({
        serializerType: 'NOT_A_TYPE',
      } as unknown as Pick<TSetSerializer, 'serializerType'>);
    }).toThrow('Unknown serializer type: NOT_A_TYPE');
    expect(kit.serializerReadOnlyMapping).toBe(readOnly);

    kit.deleteSerializer({ serializerType: 'DATE' });
    expect(kit.serializerReadOnlyMapping.has('DATE')).toBe(false);
    expect(readOnly.has('DATE')).toBe(true);

    kit.setSerializer({ serializerType: 'DATE', strategy });
    kit.setSerializer({ serializerType: 'JSON', strategy });
    kit.deleteAllSerializers();
    expect(kit.serializerReadOnlyMapping.size).toBe(0);
  });

  it('registers shutdown handlers idempotently and removes them on destroy', async (): Promise<void> => {
    const once = vi
      .spyOn(process, 'once')
      .mockImplementation(
        (
          _event: string | symbol,
          _listener: (...args: Array<unknown>) => void
        ): NodeJS.Process => process
      );
    const off = vi
      .spyOn(process, 'off')
      .mockImplementation(
        (
          _event: string | symbol,
          _listener: (...args: Array<unknown>) => void
        ): NodeJS.Process => process
      );

    const kit = new TypeOrmProcedureKit({
      config: {
        type: 'postgres',
        master: {
          host: 'localhost',
          port: 5432,
          database: 'db',
          username: 'user',
          password: 'pass',
        },
        poolSize: 1,
        parseInt8AsNumber: false,
      },
      logger: { module: createLogger() },
      isRegisterShutdownHandlers: true,
    });
    kit.registerShutdownHandlers();

    expect(once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(once).toHaveBeenCalledTimes(SHUTDOWN_SIGNALS.length);
    await kit.destroy();
    expect(off).toHaveBeenCalledTimes(SHUTDOWN_SIGNALS.length);
    once.mockRestore();
    off.mockRestore();
  });

  it('restores default signal handling during cleanup and re-sends the signal afterwards', async (): Promise<void> => {
    let signalHandler: (() => void) | undefined;
    const once = vi
      .spyOn(process, 'once')
      .mockImplementation(
        (
          event: string | symbol,
          listener: (...args: Array<unknown>) => void
        ): NodeJS.Process => {
          if (event === 'SIGTERM') signalHandler = listener;
          return process;
        }
      );
    const off = vi.spyOn(process, 'off').mockReturnValue(process);
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    try {
      const kit = createKit();
      let resolveNotificationDestroy!: () => void;
      const notificationDestroy = new Promise<void>((resolve) => {
        resolveNotificationDestroy = resolve;
      });
      Reflect.set(kit, 'notifyBase', {
        destroy: vi.fn(() => notificationDestroy),
      });
      kit.registerShutdownHandlers();

      signalHandler?.();

      expect(off).toHaveBeenCalledTimes(SHUTDOWN_SIGNALS.length);
      expect(kill).not.toHaveBeenCalled();

      resolveNotificationDestroy();
      await vi.waitFor(() => {
        expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      });
    } finally {
      once.mockRestore();
      off.mockRestore();
      kill.mockRestore();
    }
  });

  it('rejects public operations as soon as shutdown begins', async (): Promise<void> => {
    const kit = createKit();
    let resolveNotificationsDestroy!: () => void;
    const notificationsDestroyPromise = new Promise<void>((resolve) => {
      resolveNotificationsDestroy = resolve;
    });
    Object.assign(kit, {
      notifyBase: {
        destroy: vi.fn(() => notificationsDestroyPromise),
      },
    });

    const destroyPromise = kit.destroy();

    expect((): void => {
      kit.setSerializer({
        serializerType: 'DATE',
        strategy: ({ value }): string => value.toString(),
      });
    }).toThrow(SHUTDOWN_ERROR);

    resolveNotificationsDestroy();
    await destroyPromise;
  });

  it('shares one initialization promise across concurrent callers', async (): Promise<void> => {
    const kit = createKit();
    let resolveDatabaseInitialization!: () => void;
    const databaseInitialization = new Promise<void>((resolve) => {
      resolveDatabaseInitialization = resolve;
    });
    const initDatabaseModule = vi.fn(() => databaseInitialization);
    const initPackagesMap = vi.fn().mockResolvedValue(undefined);
    const kitInternals = kit as unknown as Record<string, unknown>;
    Object.assign(kitInternals, {
      databaseInitializerBase: { initDatabaseModule },
      initMainClasses(): void {
        kitInternals.procedureListBase = { initPackagesMap };
      },
    });

    const firstInitialization = kit.initDatabase();
    const secondInitialization = kit.initDatabase();

    expect(secondInitialization).toBe(firstInitialization);
    expect(initDatabaseModule).toHaveBeenCalledOnce();
    resolveDatabaseInitialization();
    await firstInitialization;
    expect(initPackagesMap).toHaveBeenCalledOnce();
    expect(kitInternals.state).toBe('ready');
  });

  it('rolls back failed initialization and returns to new state', async (): Promise<void> => {
    const kit = createKit();
    const initDatabaseModule = vi.fn().mockResolvedValue(undefined);
    const initPackagesMap = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('metadata failed'))
      .mockResolvedValue(undefined);
    const notifyDestroy = vi.fn().mockResolvedValue(undefined);
    const procedureListDestroy = vi.fn();
    const dataSourceDestroy = vi.fn().mockResolvedValue(undefined);
    const kitInternals = kit as unknown as Record<string, unknown>;
    Object.assign(kitInternals, {
      databaseInitializerBase: {
        initDatabaseModule,
        isDataSourceInitialized: true,
        appDataSource: { destroy: dataSourceDestroy },
        resetAfterFailedInitialization: vi.fn(),
      },
      initMainClasses(): void {
        Object.assign(kitInternals, {
          procedureListBase: {
            initPackagesMap,
            destroy: procedureListDestroy,
          },
          notifyBase: { destroy: notifyDestroy },
        });
      },
    });

    await expect(kit.initDatabase()).rejects.toThrow('metadata failed');
    expect(kitInternals.state).toBe('new');
    expect(notifyDestroy).toHaveBeenCalledOnce();
    expect(procedureListDestroy).toHaveBeenCalledOnce();
    expect(dataSourceDestroy).toHaveBeenCalledOnce();

    await expect(kit.initDatabase()).resolves.toBeUndefined();
    expect(kitInternals.state).toBe('ready');
    expect(initDatabaseModule).toHaveBeenCalledTimes(2);
  });

  it('uses a fresh notifier after rollback and supports dynamic notifications', async (): Promise<void> => {
    const settings = {
      packages: ['pkg' as Lowercase<string>],
      procedureObjectList: { run: 'pkg.run' },
      isNeedDynamicallyUpdatePackagesInfo: true,
    };
    const firstAdapter = createAdapterMock({
      getPackagesNotifySql: vi.fn(() => 'LISTEN package_updates'),
      listenNotify: vi.fn().mockRejectedValue(new Error('subscribe failed')),
      destroyNotifications: vi.fn().mockResolvedValue(undefined),
    });
    const secondAdapter = createAdapterMock({
      getPackagesNotifySql: vi.fn(() => 'LISTEN package_updates'),
      listenNotify: vi.fn().mockResolvedValue('package_updates'),
      destroyNotifications: vi.fn().mockResolvedValue(undefined),
    });
    let activeAdapter = firstAdapter;
    let initializationAttempt = 0;
    const resetAfterFailedInitialization = vi.fn();
    const databaseInitializerBase = {
      initDatabaseModule: vi.fn().mockImplementation((): Promise<void> => {
        activeAdapter =
          initializationAttempt === 0 ? firstAdapter : secondAdapter;
        initializationAttempt += 1;
        return Promise.resolve();
      }),
      get databaseAdapter(): typeof firstAdapter {
        return activeAdapter;
      },
      isDataSourceInitialized: false,
      resetAfterFailedInitialization,
      caseSettings: { strategy: { destroy: vi.fn() } },
    };
    const kit = new TypeOrmProcedureKit({
      config: {
        type: 'postgres',
        master: {
          host: 'localhost',
          port: 5432,
          database: 'db',
          username: 'user',
          password: 'pass',
        },
        poolSize: 1,
        parseInt8AsNumber: false,
        packagesSettings: settings,
      },
      logger: { module: createLogger() },
    });
    const kitInternals = kit as unknown as Record<string, unknown>;
    Object.assign(kitInternals, {
      databaseInitializerBase,
      initMainClasses(): void {
        const procedureListBase = {
          initPackagesMap: vi.fn().mockResolvedValue(undefined),
          fetchProcedureListWithArguments: vi.fn().mockResolvedValue(undefined),
          destroy: vi.fn().mockResolvedValue(undefined),
        };
        Object.assign(kitInternals, {
          procedureListBase,
          notifyBase: new NotifyBase(
            activeAdapter,
            procedureListBase as never,
            createLogger(),
            settings
          ),
        });
      },
    });

    await expect(kit.initDatabase()).rejects.toThrow('subscribe failed');
    expect(firstAdapter.destroyNotifications).toHaveBeenCalledOnce();
    expect(resetAfterFailedInitialization).toHaveBeenCalledOnce();

    await expect(kit.initDatabase()).resolves.toBeUndefined();
    await expect(
      kit.makeNotify({ sql: 'LISTEN manual', notifyCallback: vi.fn() })
    ).resolves.toBe('package_updates');
    expect(secondAdapter.listenNotify).toHaveBeenCalledTimes(2);
  });

  it('passes procedure metadata to execution logging context', async (): Promise<void> => {
    const kit = new TypeOrmProcedureKit({
      config: {
        type: 'postgres',
        master: {
          host: 'localhost',
          port: 5432,
          database: 'db',
          username: 'user',
          password: 'pass',
        },
        poolSize: 1,
        parseInt8AsNumber: false,
        packagesSettings: {
          packages: ['pkg'],
          procedureObjectList: { run: 'pkg.run' },
        },
      },
      logger: { module: createLogger() },
    });
    const bindings = {
      p_id: { val: 7 },
      out_cursor: {},
    };
    let capturedContext = QueryLogContextStorage.getStore();
    const executeProcedure = vi
      .fn()
      .mockImplementation((): Promise<unknown> => {
        capturedContext = QueryLogContextStorage.getStore();
        return Promise.resolve({ rows: [], outBinds: {} });
      });
    const makeBindings = vi.fn(() => ({
      paramExecuteString: 'BEGIN PKG.RUN (:p_id,:out_cursor); END;',
      bindings,
      cursorsNames: ['out_cursor'],
      outBindings: [
        {
          name: 'out_cursor',
          type: 'cursor',
          databaseType: 'REF CURSOR',
        },
      ],
    }));

    Object.assign(kit as unknown as Record<string, unknown>, {
      databaseInitializerBase: {
        databaseAdapter: {
          makeBindings,
        },
      },
      procedureListBase: {
        packagesWithProceduresList: new Map([
          [
            'pkg',
            {
              run: [
                {
                  argumentName: 'p_id',
                  argumentType: 'NUMBER',
                  order: 1,
                  mode: 'IN',
                },
                {
                  argumentName: 'out_cursor',
                  argumentType: 'REF CURSOR',
                  order: 2,
                  mode: 'OUT',
                },
              ],
            },
          ],
        ]),
        parseProcedureName: vi.fn(() => ({
          packageName: 'pkg',
          processName: 'run',
        })),
      },
      executeBase: {
        executeProcedure,
      },
    });

    await kit.call('pkg.run', { id: 7 });

    expect(executeProcedure).toHaveBeenCalledWith(
      'BEGIN PKG.RUN (:p_id,:out_cursor); END;',
      bindings,
      ['out_cursor'],
      [
        {
          name: 'out_cursor',
          type: 'cursor',
          databaseType: 'REF CURSOR',
        },
      ],
      undefined
    );
    expect(capturedContext).toEqual({
      kind: 'procedure',
      packageName: 'pkg',
      procedureName: 'run',
      bindings: [
        {
          name: 'p_id',
          type: 'NUMBER',
          mode: 'IN',
          value: 7,
          isCursor: false,
        },
        {
          name: 'out_cursor',
          type: 'REF CURSOR',
          mode: 'OUT',
          value: undefined,
          isCursor: true,
        },
      ],
    });
  });

  it('passes SQL transaction bindings to execution logging context', async (): Promise<void> => {
    const kit = createKit();
    const bindings = [7, 'secret-password'];
    let capturedContext = QueryLogContextStorage.getStore();
    const execute = vi.fn().mockImplementation((): Promise<Array<unknown>> => {
      capturedContext = QueryLogContextStorage.getStore();
      return Promise.resolve([]);
    });
    const makeSqlBindings = vi.fn(() => ({
      sqlString: 'select * from users where id = $1 and password = $2',
      bindings,
    }));

    Object.assign(kit as unknown as Record<string, unknown>, {
      databaseInitializerBase: {
        databaseAdapter: {
          makeSqlBindings,
        },
      },
      executeBase: {
        execute,
      },
    });

    await kit.callSqlTransaction(
      'select * from users where id = :ID and password = :PASSWORD',
      {
        id: 7,
        password: 'secret-password',
      }
    );

    expect(execute).toHaveBeenCalledWith(
      'select * from users where id = $1 and password = $2',
      bindings,
      [],
      undefined
    );
    expect(capturedContext).toEqual({
      kind: 'sql',
      bindings: [
        { name: 'ID', value: 7 },
        { name: 'PASSWORD', value: 'secret-password' },
      ],
    });
  });

  it('keeps successful destroy terminal for future calls', async (): Promise<void> => {
    const kit = createKit();
    const notifyDestroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const dataSourceDestroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const strategyDestroy = vi.fn<() => void>();
    const makeSqlBindings = vi.fn(() => ({
      sqlString: 'SELECT 1',
      bindings: [],
    }));

    Object.assign(kit as unknown as Record<string, unknown>, {
      notifyBase: {
        destroy: notifyDestroy,
      },
      databaseInitializerBase: {
        isDataSourceInitialized: true,
        appDataSource: {
          destroy: dataSourceDestroy,
        },
        databaseAdapter: {
          makeSqlBindings,
        },
        caseSettings: {
          strategy: {
            destroy: strategyDestroy,
          },
        },
      },
    });

    await kit.destroy();

    expect(notifyDestroy).toHaveBeenCalledOnce();
    expect(dataSourceDestroy).toHaveBeenCalledOnce();
    expect(strategyDestroy).toHaveBeenCalledOnce();
    await expectRejectionWithoutThrow(
      () => kit.call('pkg.run'),
      SHUTDOWN_ERROR
    );
    await expectRejectionWithoutThrow(
      () => kit.callSqlTransaction('SELECT 1'),
      SHUTDOWN_ERROR
    );
    expect(makeSqlBindings).not.toHaveBeenCalled();
  });

  it('keeps failed destroy terminal for future calls', async (): Promise<void> => {
    const kit = createKit();
    const once = vi.spyOn(process, 'once').mockReturnValue(process);
    const off = vi.spyOn(process, 'off').mockReturnValue(process);
    kit.registerShutdownHandlers();
    const notifyDestroy = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('notify failed'));
    const dataSourceDestroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const strategyDestroy = vi.fn<() => void>();
    const makeSqlBindings = vi.fn(() => ({
      sqlString: 'SELECT 1',
      bindings: [],
    }));

    Object.assign(kit as unknown as Record<string, unknown>, {
      notifyBase: {
        destroy: notifyDestroy,
      },
      databaseInitializerBase: {
        isDataSourceInitialized: true,
        appDataSource: {
          destroy: dataSourceDestroy,
        },
        databaseAdapter: {
          makeSqlBindings,
        },
        caseSettings: {
          strategy: {
            destroy: strategyDestroy,
          },
        },
      },
    });

    await expect(kit.destroy()).rejects.toThrow(
      'Some resources failed to cleanup during shutdown'
    );

    expect((): void => {
      kit.setSerializer({
        serializerType: 'DATE',
        strategy: ({ value }): string => value.toString(),
      });
    }).toThrow(SHUTDOWN_ERROR);
    await expectRejectionWithoutThrow(
      () => kit.callSqlTransaction('SELECT 1'),
      SHUTDOWN_ERROR
    );
    expect(makeSqlBindings).not.toHaveBeenCalled();

    await expect(kit.destroy()).rejects.toThrow(
      'Some resources failed to cleanup during shutdown'
    );
    expect(notifyDestroy).toHaveBeenCalledOnce();
    expect(dataSourceDestroy).toHaveBeenCalledOnce();
    expect(strategyDestroy).toHaveBeenCalledOnce();
    expect(off).toHaveBeenCalledTimes(SHUTDOWN_SIGNALS.length);
    once.mockRestore();
    off.mockRestore();
  });

  it('does not double-close resources on repeated destroy', async (): Promise<void> => {
    const kit = createKit();
    const notifyDestroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const dataSourceDestroy = vi.fn<() => Promise<void>>().mockResolvedValue();
    const strategyDestroy = vi.fn<() => void>();

    Object.assign(kit as unknown as Record<string, unknown>, {
      notifyBase: {
        destroy: notifyDestroy,
      },
      databaseInitializerBase: {
        isDataSourceInitialized: true,
        appDataSource: {
          destroy: dataSourceDestroy,
        },
        caseSettings: {
          strategy: {
            destroy: strategyDestroy,
          },
        },
      },
    });

    await kit.destroy();
    await kit.destroy();

    expect(notifyDestroy).toHaveBeenCalledOnce();
    expect(dataSourceDestroy).toHaveBeenCalledOnce();
    expect(strategyDestroy).toHaveBeenCalledOnce();
  });

  it('hands every later destroy() the promise of the first call and logs no warning', async (): Promise<void> => {
    const logger = createLogger();
    const kit = createKit(logger);
    let resolveNotifyDestroy!: () => void;
    const notifyDestroy = vi.fn(
      (): Promise<void> =>
        new Promise<void>((resolve) => {
          resolveNotifyDestroy = resolve;
        })
    );
    Object.assign(kit as unknown as Record<string, unknown>, {
      notifyBase: { destroy: notifyDestroy },
    });

    const firstDestroy = kit.destroy();
    const concurrentDestroy = kit.destroy();
    resolveNotifyDestroy();
    await firstDestroy;
    const laterDestroy = kit.destroy();

    expect(concurrentDestroy).toBe(firstDestroy);
    expect(laterDestroy).toBe(firstDestroy);
    await expect(laterDestroy).resolves.toBeUndefined();
    expect(notifyDestroy).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns and resolves when a failed initialization that could not roll back already ended the kit', async (): Promise<void> => {
    // The one state in which destroy() finds the kit destroyed without a shutdown of its own:
    // initDatabase() rejected with the rollback errors and made the kit terminal itself.
    const logger = createLogger();
    const kit = createKit(logger);
    const dataSourceDestroy = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('pool close failed'));
    const kitInternals = kit as unknown as Record<string, unknown>;
    Object.assign(kitInternals, {
      databaseInitializerBase: {
        initDatabaseModule: vi.fn().mockResolvedValue(undefined),
        isDataSourceInitialized: true,
        appDataSource: { destroy: dataSourceDestroy },
        resetAfterFailedInitialization: vi.fn(),
        caseSettings: { strategy: { destroy: vi.fn() } },
      },
      initMainClasses(): void {
        Object.assign(kitInternals, {
          procedureListBase: {
            initPackagesMap: vi
              .fn<() => Promise<void>>()
              .mockRejectedValue(new Error('metadata failed')),
            destroy: vi.fn(),
          },
        });
      },
    });

    await expect(kit.initDatabase()).rejects.toThrow(
      'Database initialization failed and rollback was incomplete'
    );
    expect(logger.warn).not.toHaveBeenCalled();

    await expect(kit.destroy()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'TypeOrmProcedureKit already destroyed'
    );
    expect(dataSourceDestroy).toHaveBeenCalledOnce();
    await expectRejectionWithoutThrow(
      () => kit.callSqlTransaction('SELECT 1'),
      SHUTDOWN_ERROR
    );
  });

  it('trims custom metadata notification SQL during initialization', async (): Promise<void> => {
    const { kit, getPackagesNotifySql, createNotification } =
      createMetadataNotificationHarness(' \n\t LISTEN "package_updates" \t');

    await kit.initDatabase();

    expect(createNotification).toHaveBeenCalledOnce();
    const notificationCall = createNotification.mock.calls.at(0);
    expect(notificationCall).toBeDefined();
    if (!notificationCall)
      throw new Error('Notification call was not recorded');
    const [notificationOptions] = notificationCall;
    expect(notificationOptions.sql).toBe('LISTEN "package_updates"');
    expect(typeof notificationOptions.notifyCallback).toBe('function');
    expect(getPackagesNotifySql).not.toHaveBeenCalled();
  });

  it.each([undefined, '', ' \n\t '])(
    'uses adapter metadata notification SQL when custom SQL is %j',
    async (metadataNotificationSql): Promise<void> => {
      const { kit, getPackagesNotifySql, createNotification } =
        createMetadataNotificationHarness(metadataNotificationSql);

      await kit.initDatabase();

      expect(getPackagesNotifySql).toHaveBeenCalledOnce();
      expect(getPackagesNotifySql).toHaveBeenCalledWith(['pkg']);
      expect(createNotification).toHaveBeenCalledOnce();
      const notificationCall = createNotification.mock.calls.at(0);
      expect(notificationCall).toBeDefined();
      if (!notificationCall)
        throw new Error('Notification call was not recorded');
      expect(notificationCall[0].sql).toBe('LISTEN "fallback"');
    }
  );
});

describe('TypeOrmProcedureKit promise-returning methods', (): void => {
  it.each(RUNTIME_PROMISE_METHODS)(
    '%s rejects instead of throwing before initDatabase()',
    async (_name, invoke): Promise<void> => {
      const kit = createKit(createLogger(), {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      });

      await expectRejectionWithoutThrow(
        () => invoke(kit),
        NOT_INITIALIZED_MESSAGE
      );
    }
  );

  it.each([
    ...RUNTIME_PROMISE_METHODS,
    [
      'initDatabase',
      (kit: TypeOrmProcedureKit): Promise<unknown> => kit.initDatabase(),
    ] as const,
  ])(
    '%s rejects instead of throwing after destroy()',
    async (_name, invoke): Promise<void> => {
      const kit = createKit(createLogger(), {
        packages: ['pkg'],
        procedureObjectList: { run: 'pkg.run' },
      });
      await kit.destroy();

      await expectRejectionWithoutThrow(() => invoke(kit), SHUTDOWN_ERROR);
    }
  );

  it('keeps the databaseAdapter getter synchronous and reports the kit as uninitialized', async (): Promise<void> => {
    const kit = createKit();

    expect((): void => {
      void kit.databaseAdapter;
    }).toThrow(NOT_INITIALIZED_ERROR);
    await expectRejectionWithoutThrow(
      () => kit.callSqlTransaction('SELECT 1'),
      NOT_INITIALIZED_MESSAGE
    );

    await kit.destroy();
    expect((): void => {
      void kit.databaseAdapter;
    }).toThrow(SHUTDOWN_ERROR);
  });

  it('rejects call() with the adapter error for an invalid payload', async (): Promise<void> => {
    const { kit, executeProcedure } = createKitWithRealBindings();

    await expectRejectionWithoutThrow(
      () => kit.call('pkg.run', 42 as never),
      'Payload for call procedure must be an object or array or undefined or null'
    );
    expect(executeProcedure).not.toHaveBeenCalled();
  });

  it('rejects callSqlTransaction() with the adapter error for an unbound placeholder', async (): Promise<void> => {
    const { kit, execute } = createKitWithRealBindings();

    await expectRejectionWithoutThrow(
      () => kit.callSqlTransaction('SELECT * FROM t WHERE id = :ID', {}),
      'Raw SQL placeholder :ID has no value in params; supplied keys: none'
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('exports IErrorEnvelopeKeys from the package root', (): void => {
    const envelopeKeys: IErrorEnvelopeKeys = {
      errorCodeKeys: ['status'],
      errorTextKeys: ['message'],
    };

    expect(envelopeKeys).toEqual({
      errorCodeKeys: ['status'],
      errorTextKeys: ['message'],
    });
  });
});

describe('TypeOrmProcedureKit initialization without change notification support', (): void => {
  it('loads package metadata once, warns once and starts without a subscription', async (): Promise<void> => {
    const logger = createLogger();
    const settings = {
      packages: ['pkg' as Lowercase<string>],
      procedureObjectList: { run: 'pkg.run' },
      isNeedDynamicallyUpdatePackagesInfo: true,
    };
    const adapter = createAdapterMock({
      isChangeNotificationSupported: vi.fn((): boolean => false),
      getPackagesNotifySql: vi.fn((): string => 'package change query'),
      listenNotify: vi.fn().mockResolvedValue('package_updates'),
    });
    const initPackagesMap = vi.fn().mockResolvedValue(undefined);
    const kit = createKit(logger, settings);
    const kitInternals = kit as unknown as Record<string, unknown>;
    Object.assign(kitInternals, {
      databaseInitializerBase: {
        initDatabaseModule: vi.fn().mockResolvedValue(undefined),
        databaseAdapter: adapter,
      },
      initMainClasses(): void {
        const procedureListBase = { initPackagesMap };
        Object.assign(kitInternals, {
          procedureListBase,
          notifyBase: new NotifyBase(
            adapter,
            procedureListBase as never,
            logger,
            settings
          ),
        });
      },
    });

    await expect(kit.initDatabase()).resolves.toBeUndefined();

    expect(kitInternals.state).toBe('ready');
    expect(initPackagesMap).toHaveBeenCalledOnce();
    expect(adapter.listenNotify).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      CHANGE_NOTIFICATIONS_UNSUPPORTED_WARNING
    );
  });
});

describe('TypeOrmProcedureKit naming cache after a failed initialization', (): void => {
  /**
   * Builds a kit whose metadata loading fails during initDatabase(), so that initialization
   * always takes the rollback path.
   * @param rollback - what the rollback finds: a pool that fails to close, an initializer that
   * cannot be reset, or nothing wrong.
   */
  function createFailingInitialization(
    rollback: 'pool-close-fails' | 'reset-fails' | 'complete'
  ): {
    kit: TypeOrmProcedureKit;
    strategyDestroy: ReturnType<typeof vi.fn<() => void>>;
  } {
    const kit = createKit();
    const strategyDestroy = vi.fn<() => void>();
    const kitInternals = kit as unknown as Record<string, unknown>;
    Object.assign(kitInternals, {
      databaseInitializerBase: {
        initDatabaseModule: vi.fn().mockResolvedValue(undefined),
        isDataSourceInitialized: true,
        appDataSource: {
          destroy:
            rollback === 'pool-close-fails'
              ? vi.fn().mockRejectedValue(new Error('pool close failed'))
              : vi.fn().mockResolvedValue(undefined),
        },
        resetAfterFailedInitialization:
          rollback === 'reset-fails'
            ? vi.fn((): void => {
                throw new Error('reset failed');
              })
            : vi.fn(),
        caseSettings: { strategy: { destroy: strategyDestroy } },
      },
      initMainClasses(): void {
        Object.assign(kitInternals, {
          procedureListBase: {
            initPackagesMap: vi
              .fn<() => Promise<void>>()
              .mockRejectedValue(new Error('metadata failed')),
            destroy: vi.fn(),
          },
        });
      },
    });
    return { kit, strategyDestroy };
  }

  it.each(['pool-close-fails', 'reset-fails'] as const)(
    'clears the naming cache when the rollback is incomplete (%s)',
    async (rollback): Promise<void> => {
      const { kit, strategyDestroy } = createFailingInitialization(rollback);

      await expect(kit.initDatabase()).rejects.toThrow(
        'Database initialization failed and rollback was incomplete'
      );

      expect(strategyDestroy).toHaveBeenCalledOnce();
      await expect(kit.destroy()).resolves.toBeUndefined();
      expect(strategyDestroy).toHaveBeenCalledOnce();
    }
  );

  it('keeps the naming cache when the rollback is complete, so that initDatabase() can run again', async (): Promise<void> => {
    const { kit, strategyDestroy } = createFailingInitialization('complete');

    await expect(kit.initDatabase()).rejects.toThrow('metadata failed');

    expect(strategyDestroy).not.toHaveBeenCalled();
  });
});
