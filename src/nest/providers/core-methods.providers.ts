import {
  CALL_PROCEDURE,
  CALL_SQL,
  DELETE_ALL_SERIALIZERS,
  DELETE_SERIALIZER,
  GET_DATA_SOURCE,
  MAKE_NOTIFY,
  SET_SERIALIZER,
  UNLISTEN_NOTIFY,
} from '../consts.js';
import { TypeOrmProcedureKitNestService } from '../typeorm-procedure-kit-nest.service.js';

import type { IExecutionOptions } from '../../types/config.types.js';
import type {
  TCallProcedure,
  TCallSql,
  TDeleteAllSerializers,
  TDeleteSerializer,
  TGetDataSource,
  TMakeNotify,
  TSetSerializerHandler,
  TUnlistenNotify,
} from '../../types/nest-decorator.types.js';
import type {
  ICreateNotify,
  IOracleOptionsNotify,
} from '../../types/notification.types.js';
import type {
  TProcedurePayload,
  TProcedurePayloadInput,
} from '../../types/procedure.types.js';
import type { IProcedureResult } from '../../types/utility.types.js';
import type { FactoryProvider, Provider } from '@nestjs/common';

/**
 * Builds the factory provider that exposes one service method under its own
 * injection token.
 *
 * `pick` receives the resolved service and returns the function published under
 * the token. It must return a closure that calls the method at call time rather
 * than a reference captured up front, so the published function keeps following
 * the service instance.
 *
 * @param token - The injection token the method is published under.
 * @param pick - Maps the resolved service to the published function.
 * @returns The factory provider for the token.
 */
function createMethodProvider<TMethod>(
  token: symbol,
  pick: (service: TypeOrmProcedureKitNestService) => TMethod
): FactoryProvider<TMethod> {
  return {
    provide: token,
    useFactory: pick,
    inject: [TypeOrmProcedureKitNestService],
  };
}

export const TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS: Array<Provider> = [
  createMethodProvider(
    CALL_PROCEDURE,
    (service: TypeOrmProcedureKitNestService): TCallProcedure =>
      <
        TRow,
        TPayload extends TProcedurePayload = TProcedurePayload,
        TOut extends Record<string, unknown> = Record<string, unknown>,
      >(
        executeString: string,
        params?: TProcedurePayloadInput<TPayload>,
        executionOptions?: IExecutionOptions
      ): Promise<IProcedureResult<TRow, TOut>> =>
        service.call<TRow, TPayload, TOut>(
          executeString,
          params,
          executionOptions
        )
  ),
  createMethodProvider(
    CALL_SQL,
    (service: TypeOrmProcedureKitNestService): TCallSql =>
      <T>(
        sql: string,
        params?: Record<string, unknown>,
        executionOptions?: IExecutionOptions
      ): Promise<Array<T>> =>
        service.callSqlTransaction<T>(sql, params, executionOptions)
  ),
  createMethodProvider(
    GET_DATA_SOURCE,
    (service: TypeOrmProcedureKitNestService): TGetDataSource =>
      (): ReturnType<TGetDataSource> =>
        service.dataSource
  ),
  createMethodProvider(
    MAKE_NOTIFY,
    (service: TypeOrmProcedureKitNestService): TMakeNotify =>
      <T>(
        options: ICreateNotify<T>,
        additionalOptions?: IOracleOptionsNotify
      ): Promise<string> =>
        service.makeNotify<T>(options, additionalOptions)
  ),
  createMethodProvider(
    UNLISTEN_NOTIFY,
    (service: TypeOrmProcedureKitNestService): TUnlistenNotify =>
      (channel: string): Promise<void> =>
        service.unlistenNotify(channel)
  ),
  createMethodProvider(
    SET_SERIALIZER,
    (service: TypeOrmProcedureKitNestService): TSetSerializerHandler =>
      (serializer: Parameters<TSetSerializerHandler>[0]): void => {
        service.setSerializer(serializer);
      }
  ),
  createMethodProvider(
    DELETE_SERIALIZER,
    (service: TypeOrmProcedureKitNestService): TDeleteSerializer =>
      (serializerType: Parameters<TDeleteSerializer>[0]): void => {
        service.deleteSerializer(serializerType);
      }
  ),
  createMethodProvider(
    DELETE_ALL_SERIALIZERS,
    (service: TypeOrmProcedureKitNestService): TDeleteAllSerializers =>
      (): void => {
        service.deleteAllSerializers();
      }
  ),
];
