import type { FactoryProvider, Provider } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  CALL_PROCEDURE,
  CALL_SQL,
  DELETE_ALL_SERIALIZERS,
  DELETE_SERIALIZER,
  GET_DATA_SOURCE,
  MAKE_NOTIFY,
  SET_SERIALIZER,
  TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
  UNLISTEN_NOTIFY,
} from '../../src/nest/consts.js';
import { TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS } from '../../src/nest/providers/index.js';
import type { TypeOrmProcedureKitNestService } from '../../src/nest/typeorm-procedure-kit-nest.service.js';
import type {
  TCallProcedure,
  TCallSql,
  TDeleteAllSerializers,
  TDeleteSerializer,
  TGetDataSource,
  TMakeNotify,
  TSetSerializer,
  TUnlistenNotify,
} from '../../src/types/nest-decorator.types.js';
import { ServerError } from '../../src/utils/server-error.js';

interface IProcedureParams {
  id: number;
}

function getFactoryProvider(token: symbol): FactoryProvider<unknown> {
  const provider = TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS.find(
    (item: Provider): boolean =>
      typeof item === 'object' &&
      item !== null &&
      'provide' in item &&
      item.provide === token
  );

  if (!provider || !('useFactory' in provider)) {
    throw new ServerError(`Factory provider ${token.toString()} not found`);
  }

  return provider as FactoryProvider<unknown>;
}

describe('core method Nest providers', (): void => {
  it('registers all public method tokens', (): void => {
    expect(TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS).toEqual([
      CALL_PROCEDURE,
      CALL_SQL,
      GET_DATA_SOURCE,
      MAKE_NOTIFY,
      UNLISTEN_NOTIFY,
      SET_SERIALIZER,
      DELETE_SERIALIZER,
      DELETE_ALL_SERIALIZERS,
    ]);
  });

  it('delegates injected functions to TypeOrmProcedureKitNestService methods', async (): Promise<void> => {
    const dataSource = { isInitialized: true } as ReturnType<TGetDataSource>;
    const dataSourceGetter = vi.fn<() => ReturnType<TGetDataSource>>(
      () => dataSource
    );
    const service = {
      call: vi.fn().mockResolvedValue([{ id: 1 }]),
      callSqlTransaction: vi.fn().mockResolvedValue([{ value: 1 }]),
      get dataSource(): ReturnType<TGetDataSource> {
        return dataSourceGetter();
      },
      makeNotify: vi.fn().mockResolvedValue('channel'),
      unlistenNotify: vi.fn().mockResolvedValue(undefined),
      setSerializer: vi.fn(),
      deleteSerializer: vi.fn(),
      deleteAllSerializers: vi.fn(),
    } as unknown as TypeOrmProcedureKitNestService;

    const callProcedure = getFactoryProvider(CALL_PROCEDURE).useFactory(
      service
    ) as TCallProcedure;
    const callSql = getFactoryProvider(CALL_SQL).useFactory(
      service
    ) as TCallSql;
    const getDataSource = getFactoryProvider(GET_DATA_SOURCE).useFactory(
      service
    ) as TGetDataSource;
    const makeNotify = getFactoryProvider(MAKE_NOTIFY).useFactory(
      service
    ) as TMakeNotify;
    const unlistenNotify = getFactoryProvider(UNLISTEN_NOTIFY).useFactory(
      service
    ) as TUnlistenNotify;
    const setSerializer = getFactoryProvider(SET_SERIALIZER).useFactory(
      service
    ) as TSetSerializer;
    const deleteSerializer = getFactoryProvider(DELETE_SERIALIZER).useFactory(
      service
    ) as TDeleteSerializer;
    const deleteAllSerializers = getFactoryProvider(
      DELETE_ALL_SERIALIZERS
    ).useFactory(service) as TDeleteAllSerializers;

    await expect(
      callProcedure<{ id: number }>(
        'pkg.proc',
        { id: 1 },
        {
          optionsCommands: ['SET LOCAL x = 1'],
          mode: 'slave',
        }
      )
    ).resolves.toEqual([{ id: 1 }]);
    const typedParams: IProcedureParams = { id: 1 };
    await expect(
      callProcedure<{ id: number }>('pkg.proc', typedParams)
    ).resolves.toEqual([{ id: 1 }]);
    await expect(
      callProcedure<{ id: number }, IProcedureParams>('pkg.proc', typedParams)
    ).resolves.toEqual([{ id: 1 }]);
    await expect(
      callSql<{ value: number }>(
        'SELECT :ID',
        { ID: 1 },
        {
          optionsCommands: ['SET LOCAL x = 1'],
          mode: 'slave',
        }
      )
    ).resolves.toEqual([{ value: 1 }]);
    await expect(
      makeNotify({ sql: 'LISTEN channel', notifyCallback: vi.fn() })
    ).resolves.toBe('channel');
    await expect(unlistenNotify('channel')).resolves.toBeUndefined();
    expect(getDataSource()).toBe(dataSource);

    const serializer = {
      serializerType: 'DATE',
      strategy: vi.fn(),
    } as const;
    setSerializer(serializer);
    deleteSerializer({ serializerType: 'DATE' });
    deleteAllSerializers();

    expect(service.call).toHaveBeenNthCalledWith(
      1,
      'pkg.proc',
      { id: 1 },
      {
        optionsCommands: ['SET LOCAL x = 1'],
        mode: 'slave',
      }
    );
    expect(service.call).toHaveBeenNthCalledWith(
      2,
      'pkg.proc',
      typedParams,
      undefined
    );
    expect(service.call).toHaveBeenNthCalledWith(
      3,
      'pkg.proc',
      typedParams,
      undefined
    );
    expect(service.callSqlTransaction).toHaveBeenCalledWith(
      'SELECT :ID',
      { ID: 1 },
      {
        optionsCommands: ['SET LOCAL x = 1'],
        mode: 'slave',
      }
    );
    expect(service.makeNotify).toHaveBeenCalledWith(
      expect.objectContaining({ sql: 'LISTEN channel' }),
      undefined
    );
    expect(dataSourceGetter).toHaveBeenCalledOnce();
    expect(service.unlistenNotify).toHaveBeenCalledWith('channel');
    expect(service.setSerializer).toHaveBeenCalledWith(serializer);
    expect(service.deleteSerializer).toHaveBeenCalledWith({
      serializerType: 'DATE',
    });
    expect(service.deleteAllSerializers).toHaveBeenCalledOnce();
  });
});
