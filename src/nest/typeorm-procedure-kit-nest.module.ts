import { Module } from '@nestjs/common';

import {
  DATABASE_CONFIG_TOKEN,
  DATABASE_SERVICE_TOKEN,
  TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
} from './consts.js';
import { TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS } from './providers/index.js';
import { TypeOrmProcedureKitNestService } from './typeorm-procedure-kit-nest.service.js';

import type { IModuleConfig } from '../types/base.types.js';
import type {
  DynamicModule,
  ForwardReference,
  InjectionToken,
  OptionalFactoryDependency,
  Provider,
  Type,
} from '@nestjs/common';

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
    return buildDynamicModule(
      {
        provide: DATABASE_CONFIG_TOKEN,
        useValue: options,
      },
      { global: isGlobal }
    );
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
    return buildDynamicModule(
      {
        provide: DATABASE_CONFIG_TOKEN,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      {
        global: options.isGlobal ?? false,
        imports: options.imports ?? [],
      }
    );
  }
}

/**
 * Assembles the dynamic module both registration paths share.
 *
 * Only the provider that supplies IModuleConfig differs between them, so it
 * is passed in; everything else - the service, its DATABASE_SERVICE_TOKEN
 * alias, the method providers and the exported tokens - is identical.
 *
 * @param configProvider - The provider that resolves DATABASE_CONFIG_TOKEN.
 * @param moduleOptions - The registration-specific module declarations; keys
 *  left out here stay absent from the returned dynamic module.
 * @returns The assembled dynamic module.
 */
function buildDynamicModule(
  configProvider: Provider,
  moduleOptions: Pick<DynamicModule, 'global' | 'imports'>
): DynamicModule {
  return {
    module: TypeOrmProcedureKitNestModule,
    ...moduleOptions,
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
