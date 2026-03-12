import {
  Module,
  Global,
  type DynamicModule,
  type Provider,
  type InjectionToken,
  type OptionalFactoryDependency,
} from '@nestjs/common';

import type { IModuleConfig } from '../types/base.types.js';

import { DATABASE_CONFIG_TOKEN, DATABASE_SERVICE_TOKEN } from './consts.js';
import { TypeOrmProcedureKitNestService } from './typeorm-procedure-kit-nest.service.js';

@Global()
@Module({})
export class TypeOrmProcedureKitNestModule {
  /**
   * Returns a dynamic module for the given options.
   *
   * This method is used to create a global module which is used
   * to register the TypeOrmProcedureKitNestService globally.
   *
   * @param options - The options to register the global module with.
   * @returns A dynamic module for the given options.
   */
  public static forRoot(options: IModuleConfig): DynamicModule {
    return {
      module: TypeOrmProcedureKitNestModule,
      providers: [
        {
          provide: DATABASE_CONFIG_TOKEN,
          useValue: options,
        },
        TypeOrmProcedureKitNestService,
        {
          provide: DATABASE_SERVICE_TOKEN,
          useExisting: TypeOrmProcedureKitNestService,
        },
      ],
      exports: [TypeOrmProcedureKitNestService, DATABASE_SERVICE_TOKEN],
    };
  }
  /**
   * Returns a dynamic module for the given options.
   *
   * This method is used to create a global module which is used
   * to register the TypeORMProcedureKitService globally.
   *
   * @param options - An object containing the following properties:
   *  - useFactory: A function that returns a Promise of IModuleConfig or IModuleConfig
   *  - inject: An array of InjectionToken or OptionalFactoryDependency
   * @returns A dynamic module for the given options.
   */
  public static forRootAsync(options: {
    useFactory: (
      ...args: Array<never>
    ) => Promise<IModuleConfig> | IModuleConfig;
    inject?: Array<InjectionToken | OptionalFactoryDependency>;
  }): DynamicModule {
    const configProvider: Provider = {
      provide: DATABASE_CONFIG_TOKEN,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };
    return {
      module: TypeOrmProcedureKitNestModule,
      providers: [
        configProvider,
        TypeOrmProcedureKitNestService,
        {
          provide: DATABASE_SERVICE_TOKEN,
          useExisting: TypeOrmProcedureKitNestService,
        },
      ],
      exports: [TypeOrmProcedureKitNestService, DATABASE_SERVICE_TOKEN],
    };
  }
}
