import { describe, expect, it, vi } from 'vitest';

import { TypeOrmProcedureKit } from '../../src/core/index.js';
import { QueryLogContextStorage } from '../../src/utils/query-log-context.js';
import { ServerError } from '../../src/utils/server-error.js';
import { createLogger } from '../support/helpers.js';

const SHUTDOWN_ERROR = 'TypeOrmProcedureKit is shutting down or destroyed';

function createKit(): TypeOrmProcedureKit {
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
      parseInt8AsBigInt: false,
    },
    logger: { module: createLogger() },
  });
}

describe('TypeOrmProcedureKit', (): void => {
  it('throws useful errors before initialization', (): void => {
    const kit = createKit();

    expect((): void => {
      kit.call('pkg.run');
    }).toThrow('Procedure packages are not configured');
    expect((): void => {
      kit.setSerializer({
        serializerType: 'DATE',
        strategy: (value: string | Buffer): string => value.toString(),
      });
    }).toThrow(ServerError);
    expect((): void => {
      void kit.serializerReadOnlyMapping;
    }).toThrow(ServerError);
  });

  it('registers shutdown handlers when requested', (): void => {
    const once = vi
      .spyOn(process, 'once')
      .mockImplementation(
        (
          _event: string | symbol,
          _listener: (...args: Array<unknown>) => void
        ): NodeJS.Process => process
      );

    new TypeOrmProcedureKit({
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
        parseInt8AsBigInt: false,
      },
      logger: { module: createLogger() },
      isRegisterShutdownHandlers: true,
    });

    expect(once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    once.mockRestore();
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
        strategy: (value: string | Buffer): string => value.toString(),
      });
    }).toThrow(SHUTDOWN_ERROR);

    resolveNotificationsDestroy();
    await destroyPromise;
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
        parseInt8AsBigInt: false,
        packagesSettings: {
          packages: ['pkg'],
          procedureObjectList: { run: 'pkg.run' },
        },
      },
      logger: { module: createLogger() },
    });
    const bindings = [{ val: 7 }, {}];
    let capturedContext = QueryLogContextStorage.getStore();
    const execute = vi.fn().mockImplementation((): Promise<Array<unknown>> => {
      capturedContext = QueryLogContextStorage.getStore();
      return Promise.resolve([]);
    });
    const makeBindings = vi.fn(() => ({
      paramExecuteString: 'BEGIN PKG.RUN (:p_id,:out_cursor); END;',
      bindings,
      cursorsNames: ['out_cursor'],
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
      },
      executeBase: {
        execute,
      },
    });

    await kit.call('pkg.run', { id: 7 });

    expect(execute).toHaveBeenCalledWith(
      'BEGIN PKG.RUN (:p_id,:out_cursor); END;',
      bindings,
      ['out_cursor'],
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
    expect((): void => {
      kit.call('pkg.run');
    }).toThrow(SHUTDOWN_ERROR);
    expect((): void => {
      kit.callSqlTransaction('SELECT 1');
    }).toThrow(SHUTDOWN_ERROR);
    expect(makeSqlBindings).not.toHaveBeenCalled();
  });

  it('keeps failed destroy terminal for future calls', async (): Promise<void> => {
    const kit = createKit();
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
        strategy: (value: string | Buffer): string => value.toString(),
      });
    }).toThrow(SHUTDOWN_ERROR);
    expect((): void => {
      kit.callSqlTransaction('SELECT 1');
    }).toThrow(SHUTDOWN_ERROR);
    expect(makeSqlBindings).not.toHaveBeenCalled();

    await expect(kit.destroy()).resolves.toBeUndefined();
    expect(notifyDestroy).toHaveBeenCalledOnce();
    expect(dataSourceDestroy).toHaveBeenCalledOnce();
    expect(strategyDestroy).toHaveBeenCalledOnce();
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

  it('uses custom metadata notification SQL during initialization', async (): Promise<void> => {
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
        parseInt8AsBigInt: false,
        packagesSettings: {
          packages: ['pkg'],
          procedureObjectList: { run: 'pkg.run' },
          isNeedDynamicallyUpdatePackagesInfo: true,
          metadataNotificationSql: 'LISTEN "package_updates"',
        },
      },
      logger: { module: createLogger() },
    });
    const getPackagesNotifySql = vi.fn((): string => 'LISTEN "fallback"');
    const createNotification = vi
      .fn<
        (_options: {
          sql: string;
          notifyCallback: (args: unknown) => unknown;
        }) => Promise<string>
      >()
      .mockResolvedValue('package_updates');
    const kitInternals = kit as unknown as Record<string, unknown>;

    Object.assign(kitInternals, {
      databaseInitializerBase: {
        initDatabaseModule: vi.fn().mockResolvedValue(undefined),
        databaseAdapter: {
          getPackagesNotifySql,
        },
      },
      initMainClasses(): void {
        Object.assign(kitInternals, {
          procedureListBase: {
            initPackagesMap: vi.fn().mockResolvedValue(undefined),
          },
          notifyBase: {
            createNotification,
            packageNotifyCallback: vi.fn(),
          },
        });
      },
    });

    await kit.initDatabase();

    expect(createNotification).toHaveBeenCalledOnce();
    const [notificationOptions] = createNotification.mock.calls[0]!;
    expect(notificationOptions.sql).toBe('LISTEN "package_updates"');
    expect(typeof notificationOptions.notifyCallback).toBe('function');
    expect(getPackagesNotifySql).not.toHaveBeenCalled();
  });
});
