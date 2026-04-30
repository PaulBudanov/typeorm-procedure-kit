import type { Provider } from '@nestjs/common';

import type {
  TCallProcedure,
  TCallSql,
  TDeleteAllSerializers,
  TDeleteSerializer,
  TMakeNotify,
  TSetSerializer,
  TUnlistenNotify,
} from '../../types/nest-decorator.types.js';
import type {
  ICreateNotify,
  IOracleOptionsNotify,
} from '../../types/notification.types.js';
import {
  CALL_PROCEDURE,
  CALL_SQL,
  DELETE_ALL_SERIALIZERS,
  DELETE_SERIALIZER,
  MAKE_NOTIFY,
  SET_SERIALIZER,
  UNLISTEN_NOTIFY,
} from '../consts.js';
import { TypeOrmProcedureKitNestService } from '../typeorm-procedure-kit-nest.service.js';

export const TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS: Array<Provider> = [
  {
    provide: CALL_PROCEDURE,
    useFactory: (service: TypeOrmProcedureKitNestService): TCallProcedure => {
      return <T>(
        executeString: string,
        params?: Record<string, unknown> | Array<unknown>,
        options?: Array<string>
      ): Promise<Array<T>> => service.call<T>(executeString, params, options);
    },
    inject: [TypeOrmProcedureKitNestService],
  },
  {
    provide: CALL_SQL,
    useFactory: (service: TypeOrmProcedureKitNestService): TCallSql => {
      return <T>(
        sql: string,
        params?: Record<string, unknown>,
        options?: Array<string>
      ): Promise<Array<T>> =>
        service.callSqlTransaction<T>(sql, params, options);
    },
    inject: [TypeOrmProcedureKitNestService],
  },
  {
    provide: MAKE_NOTIFY,
    useFactory: (service: TypeOrmProcedureKitNestService): TMakeNotify => {
      return <T>(
        options: ICreateNotify<T>,
        additionalOptions?: IOracleOptionsNotify
      ): Promise<string> => service.makeNotify<T>(options, additionalOptions);
    },
    inject: [TypeOrmProcedureKitNestService],
  },
  {
    provide: UNLISTEN_NOTIFY,
    useFactory: (service: TypeOrmProcedureKitNestService): TUnlistenNotify => {
      return (channel: string): Promise<void> =>
        service.unlistenNotify(channel);
    },
    inject: [TypeOrmProcedureKitNestService],
  },
  {
    provide: SET_SERIALIZER,
    useFactory: (service: TypeOrmProcedureKitNestService): TSetSerializer => {
      return (serializer: Parameters<TSetSerializer>[0]): void =>
        service.setSerializer(serializer);
    },
    inject: [TypeOrmProcedureKitNestService],
  },
  {
    provide: DELETE_SERIALIZER,
    useFactory: (
      service: TypeOrmProcedureKitNestService
    ): TDeleteSerializer => {
      return (serializerType: Parameters<TDeleteSerializer>[0]): void =>
        service.deleteSerializer(serializerType);
    },
    inject: [TypeOrmProcedureKitNestService],
  },
  {
    provide: DELETE_ALL_SERIALIZERS,
    useFactory: (
      service: TypeOrmProcedureKitNestService
    ): TDeleteAllSerializers => {
      return (): void => service.deleteAllSerializers();
    },
    inject: [TypeOrmProcedureKitNestService],
  },
];
