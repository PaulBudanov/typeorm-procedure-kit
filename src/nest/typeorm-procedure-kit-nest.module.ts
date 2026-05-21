import {
  Module,
  type DynamicModule,
  type ForwardReference,
  type InjectionToken,
  type OptionalFactoryDependency,
  type Provider,
  type Type,
} from '@nestjs/common';

import type { IModuleConfig } from '../types/base.types.js';

import {
  DATABASE_CONFIG_TOKEN,
  DATABASE_SERVICE_TOKEN,
  TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
} from './consts.js';
import { TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS } from './providers/index.js';
import { TypeOrmProcedureKitNestService } from './typeorm-procedure-kit-nest.service.js';

@Module({})
export class TypeOrmProcedureKitNestModule {
  /**
   * Returns a dynamic module for the given options.
   *
   * This method registers TypeOrmProcedureKitNestService in the importing
   * module, or globally when isGlobal is true.
   *
   * @param options - The options to register the module with.
   * @param isGlobal - Whether to register the dynamic module globally.
   * @returns A dynamic module for the given options.
   */
  public static forRoot(
    options: IModuleConfig,
    isGlobal = false
  ): DynamicModule {
    return {
      module: TypeOrmProcedureKitNestModule,
      global: isGlobal,
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
        ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS,
      ],
      exports: [
        TypeOrmProcedureKitNestService,
        DATABASE_SERVICE_TOKEN,
        ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
      ],
    };
  }
  /**
   * Returns a dynamic module for the given options.
   *
   * This method registers TypeORMProcedureKitService in the importing module,
   * or globally when options.isGlobal is true.
   *
   * @param options - An object containing the following properties:
   *  - useFactory: A function that returns a Promise of IModuleConfig or IModuleConfig
   *  - inject: An array of InjectionToken or OptionalFactoryDependency
   *  - isGlobal: Whether to register the dynamic module globally
   * @returns A dynamic module for the given options.
   */
  public static forRootAsync(options: {
    useFactory: (
      ...args: Array<never>
    ) => Promise<IModuleConfig> | IModuleConfig;
    inject?: Array<InjectionToken | OptionalFactoryDependency>;
    imports?: Array<
      | Type<never>
      | Type<unknown>
      | DynamicModule
      | Promise<DynamicModule>
      | ForwardReference
    >;
    isGlobal?: boolean;
  }): DynamicModule {
    const configProvider: Provider = {
      provide: DATABASE_CONFIG_TOKEN,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };
    return {
      module: TypeOrmProcedureKitNestModule,
      global: options.isGlobal !== undefined ? options.isGlobal : false,
      imports: options.imports ?? [],
      providers: [
        configProvider,
        TypeOrmProcedureKitNestService,
        {
          provide: DATABASE_SERVICE_TOKEN,
          useExisting: TypeOrmProcedureKitNestService,
        },
        ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS,
      ],
      exports: [
        TypeOrmProcedureKitNestService,
        DATABASE_SERVICE_TOKEN,
        ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
      ],
    };
  }
}
