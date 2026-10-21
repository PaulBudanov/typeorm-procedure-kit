import oracledb from 'oracledb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OracleAdapter } from '../../src/adapters/oracle/oracle-adapter.js';
import { PostgreAdapter } from '../../src/adapters/postgres/postgre-adapter.js';
import { createLogger } from '../support/helpers.js';

import type { ITestLogger } from '../support/helpers.js';

const handlerOptions = {
  isNeedRegisterDefaultSerializers: false,
  caseStrategy: { transformColumnName: (value: string): string => value },
};

function createOracleAdapter(logger: ITestLogger): OracleAdapter {
  return new OracleAdapter(
    {
      options: { replication: { master: {} } },
      driver: { version: '19.0.0.0.0', setFetchTypeHandler: vi.fn() },
    } as never,
    logger,
    handlerOptions
  );
}

function createPostgreAdapter(logger: ITestLogger): PostgreAdapter {
  return new PostgreAdapter(
    { options: { replication: { master: {} } } } as never,
    logger,
    handlerOptions
  );
}

describe('database adapter change notifications', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('reads Oracle package names with the Oracle notifier', (): void => {
    const logger = createLogger();
    const adapter = createOracleAdapter(logger);

    expect(
      adapter.readPackageChangeNotification([{ NAME: 'BILLING' }, { NAME: 42 }])
    ).toEqual(['BILLING']);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'Ignoring Oracle package notification without a string NAME field'
    );
  });

  it('reads PostgreSQL package names with the PostgreSQL notifier', (): void => {
    const logger = createLogger();
    const adapter = createPostgreAdapter(logger);

    expect(
      adapter.readPackageChangeNotification({
        event: 'CREATE',
        object: 'billing',
      })
    ).toEqual(['billing']);
    expect(
      adapter.readPackageChangeNotification([{ NAME: 'BILLING' }])
    ).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'Ignoring PostgreSQL package notification without a string "object" field'
    );
  });

  it.each([
    { mode: 'Thin', isThin: true, isSupported: false },
    { mode: 'Thick', isThin: false, isSupported: true },
  ])(
    'reports Oracle change notifications as supported: $isSupported in $mode mode',
    ({ isThin, isSupported }): void => {
      vi.spyOn(oracledb, 'thin', 'get').mockReturnValue(isThin);
      const adapter = createOracleAdapter(createLogger());

      expect(adapter.isChangeNotificationSupported()).toBe(isSupported);
    }
  );

  it('reports PostgreSQL change notifications as supported', (): void => {
    const adapter = createPostgreAdapter(createLogger());

    expect(adapter.isChangeNotificationSupported()).toBe(true);
  });
});
