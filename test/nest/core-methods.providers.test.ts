import type { FactoryProvider, Provider } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  CALL_PROCEDURE,
  CALL_SQL,
  DELETE_ALL_SERIALIZERS,
  DELETE_SERIALIZER,
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
  TMakeNotify,
  TSetSerializer,
  TUnlistenNotify,
} from '../../src/types/nest-decorator.types.js';

function getFactoryProvider(token: symbol): FactoryProvider<unknown> {
  const provider = TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS.find(
    (item: Provider): boolean =>
      typeof item === 'object' &&
      item !== null &&
      'provide' in item &&
      item.provide === token
  );

  if (!provider || !('useFactory' in provider)) {
    throw new Error(`Factory provider ${token.toString()} not found`);
  }

  return provider as FactoryProvider<unknown>;
}

describe('core method Nest providers', (): void => {
  it('registers all public method tokens', (): void => {
    expect(TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS).toEqual([
      CALL_PROCEDURE,
      CALL_SQL,
      MAKE_NOTIFY,
      UNLISTEN_NOTIFY,
      SET_SERIALIZER,
      DELETE_SERIALIZER,
      DELETE_ALL_SERIALIZERS,
    ]);
  });

  it('delegates injected functions to TypeOrmProcedureKitNestService methods', async (): Promise<void> => {
    const service = {
      call: vi.fn().mockResolvedValue([{ id: 1 }]),
      callSqlTransaction: vi.fn().mockResolvedValue([{ value: 1 }]),
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
      callProcedure<{ id: number }>('pkg.proc', { id: 1 }, ['SET x = 1'])
    ).resolves.toEqual([{ id: 1 }]);
    await expect(
      callSql<{ value: number }>('SELECT :ID', { ID: 1 }, ['SET x = 1'])
    ).resolves.toEqual([{ value: 1 }]);
    await expect(
      makeNotify({ sql: 'LISTEN channel', notifyCallback: vi.fn() })
    ).resolves.toBe('channel');
    await expect(unlistenNotify('channel')).resolves.toBeUndefined();

    const serializer = {
      serializerType: 'DATE',
      strategy: vi.fn(),
    } as const;
    setSerializer(serializer);
    deleteSerializer({ serializerType: 'DATE' });
    deleteAllSerializers();

    expect(service.call).toHaveBeenCalledWith('pkg.proc', { id: 1 }, [
      'SET x = 1',
    ]);
    expect(service.callSqlTransaction).toHaveBeenCalledWith(
      'SELECT :ID',
      { ID: 1 },
      ['SET x = 1']
    );
    expect(service.makeNotify).toHaveBeenCalledWith(
      expect.objectContaining({ sql: 'LISTEN channel' }),
      undefined
    );
    expect(service.unlistenNotify).toHaveBeenCalledWith('channel');
    expect(service.setSerializer).toHaveBeenCalledWith(serializer);
    expect(service.deleteSerializer).toHaveBeenCalledWith({
      serializerType: 'DATE',
    });
    expect(service.deleteAllSerializers).toHaveBeenCalledOnce();
  });
});
