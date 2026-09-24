import { describe, expect, it, vi } from 'vitest';

import {
  DATABASE_CONFIG_TOKEN,
  DATABASE_SERVICE_TOKEN,
  DELETE_ALL_SERIALIZERS,
  TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
} from '../../src/nest/consts.js';
import { TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS } from '../../src/nest/providers/index.js';
import { TypeOrmProcedureKitNestModule } from '../../src/nest/typeorm-procedure-kit-nest.module.js';
import { TypeOrmProcedureKitNestService } from '../../src/nest/typeorm-procedure-kit-nest.service.js';
import { createLogger } from '../support/helpers.js';

import type { IModuleConfig } from '../../src/types/base.types.js';
import type {
  DynamicModule,
  InjectionToken,
  OptionalFactoryDependency,
} from '@nestjs/common';

const config = {
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
} as const;

/**
 * Minimal stand-in for the Nest injector: walks the dynamic module's own
 * provider list the way Nest would and resolves every token from it. It is
 * deliberately not a shape assertion - a wrong token, a wrong `inject` entry or
 * a `useExisting` that points at an unregistered provider fails here.
 */
function buildContainer(
  dynamicModule: DynamicModule,
  seed: Array<[unknown, unknown]> = []
): Map<unknown, unknown> {
  const container = new Map<unknown, unknown>(seed);

  for (const provider of dynamicModule.providers ?? []) {
    if (typeof provider === 'function') {
      // Mirrors `@Inject(DATABASE_CONFIG_TOKEN)` on the service constructor.
      expect(container.has(DATABASE_CONFIG_TOKEN)).toBe(true);
      container.set(
        provider,
        new TypeOrmProcedureKitNestService(
          container.get(DATABASE_CONFIG_TOKEN) as IModuleConfig
        )
      );
      continue;
    }

    if ('useValue' in provider) {
      container.set(provider.provide, provider.useValue);
      continue;
    }

    if ('useExisting' in provider) {
      expect(container.has(provider.useExisting)).toBe(true);
      container.set(provider.provide, container.get(provider.useExisting));
      continue;
    }

    if ('useFactory' in provider) {
      const dependencies = (provider.inject ?? []).map(
        (token: InjectionToken | OptionalFactoryDependency): unknown => {
          expect(container.has(token)).toBe(true);
          return container.get(token);
        }
      );
      container.set(provider.provide, provider.useFactory(...dependencies));
      continue;
    }

    throw new Error('Unsupported provider shape in the dynamic module');
  }

  return container;
}

describe('TypeOrmProcedureKitNestModule', (): void => {
  it('creates a synchronous scoped dynamic module by default', (): void => {
    const module = TypeOrmProcedureKitNestModule.forRoot(config);

    expect(module.global).toBe(false);
    expect(module.providers).toContain(TypeOrmProcedureKitNestService);
    expect(module.exports).toEqual([
      TypeOrmProcedureKitNestService,
      DATABASE_SERVICE_TOKEN,
      ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
    ]);
    expect(module.providers).toEqual(
      expect.arrayContaining([
        { provide: DATABASE_CONFIG_TOKEN, useValue: config },
        {
          provide: DATABASE_SERVICE_TOKEN,
          useExisting: TypeOrmProcedureKitNestService,
        },
        ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS,
      ])
    );
  });

  it('creates a synchronous global dynamic module when requested', (): void => {
    const module = TypeOrmProcedureKitNestModule.forRoot(config, true);

    expect(module.global).toBe(true);
  });

  it('creates an asynchronous scoped dynamic module by default', (): void => {
    const useFactory = (): typeof config => config;
    const module = TypeOrmProcedureKitNestModule.forRootAsync({
      useFactory,
      inject: ['TOKEN'],
      imports: [],
    });

    expect(module.global).toBe(false);
    expect(module.imports).toEqual([]);
    expect(module.providers).toEqual(
      expect.arrayContaining([
        {
          provide: DATABASE_CONFIG_TOKEN,
          useFactory,
          inject: ['TOKEN'],
        },
        ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS,
      ])
    );
    expect(module.exports).toEqual([
      TypeOrmProcedureKitNestService,
      DATABASE_SERVICE_TOKEN,
      ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
    ]);
  });

  it('creates an asynchronous global dynamic module when requested', (): void => {
    const useFactory = (): typeof config => config;
    const module = TypeOrmProcedureKitNestModule.forRootAsync({
      useFactory,
      isGlobal: true,
    });

    expect(module.global).toBe(true);
  });
  it('declares the same providers and exports on both registration paths', (): void => {
    const useFactory = (): typeof config => config;
    const syncModule = TypeOrmProcedureKitNestModule.forRoot(config);
    const asyncModule = TypeOrmProcedureKitNestModule.forRootAsync({
      useFactory,
    });

    const expectedProviders = [
      TypeOrmProcedureKitNestService,
      {
        provide: DATABASE_SERVICE_TOKEN,
        useExisting: TypeOrmProcedureKitNestService,
      },
      ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS,
    ];
    const expectedExports = [
      TypeOrmProcedureKitNestService,
      DATABASE_SERVICE_TOKEN,
      ...TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
    ];

    expect(syncModule.module).toBe(TypeOrmProcedureKitNestModule);
    expect(asyncModule.module).toBe(TypeOrmProcedureKitNestModule);
    expect(syncModule.providers).toEqual([
      { provide: DATABASE_CONFIG_TOKEN, useValue: config },
      ...expectedProviders,
    ]);
    expect(asyncModule.providers).toEqual([
      { provide: DATABASE_CONFIG_TOKEN, useFactory, inject: [] },
      ...expectedProviders,
    ]);
    expect(syncModule.exports).toEqual(expectedExports);
    expect(asyncModule.exports).toEqual(expectedExports);
  });

  it('keeps forRoot free of an imports declaration', (): void => {
    const syncModule = TypeOrmProcedureKitNestModule.forRoot(config);

    expect(Object.keys(syncModule).sort()).toEqual([
      'exports',
      'global',
      'module',
      'providers',
    ]);
    expect(
      Object.keys(
        TypeOrmProcedureKitNestModule.forRootAsync({
          useFactory: (): typeof config => config,
        })
      ).sort()
    ).toEqual(['exports', 'global', 'imports', 'module', 'providers']);
  });

  it('resolves every exported token from the synchronous module graph', (): void => {
    const container = buildContainer(
      TypeOrmProcedureKitNestModule.forRoot(config)
    );
    const service = container.get(TypeOrmProcedureKitNestService);

    expect(service).toBeInstanceOf(TypeOrmProcedureKitNestService);
    expect(container.get(DATABASE_SERVICE_TOKEN)).toBe(service);
    expect(container.get(DATABASE_CONFIG_TOKEN)).toBe(config);
    for (const token of TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS) {
      expect(typeof container.get(token)).toBe('function');
    }

    const deleteAllSerializers = vi
      .spyOn(service as TypeOrmProcedureKitNestService, 'deleteAllSerializers')
      .mockImplementation((): void => undefined);
    (container.get(DELETE_ALL_SERIALIZERS) as () => void)();

    expect(deleteAllSerializers).toHaveBeenCalledOnce();
  });

  it('resolves every exported token from the asynchronous module graph', (): void => {
    const container = buildContainer(
      TypeOrmProcedureKitNestModule.forRootAsync({
        useFactory: (): typeof config => config,
        inject: [],
      })
    );
    const service = container.get(TypeOrmProcedureKitNestService);

    expect(service).toBeInstanceOf(TypeOrmProcedureKitNestService);
    expect(container.get(DATABASE_SERVICE_TOKEN)).toBe(service);
    for (const token of TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS) {
      expect(typeof container.get(token)).toBe('function');
    }
  });
});
