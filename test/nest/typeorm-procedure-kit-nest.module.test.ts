import { describe, expect, it } from 'vitest';

import {
  DATABASE_CONFIG_TOKEN,
  DATABASE_SERVICE_TOKEN,
  TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDER_TOKENS,
} from '../../src/nest/consts.js';
import { TYPEORM_PROCEDURE_KIT_NEST_METHOD_PROVIDERS } from '../../src/nest/providers/index.js';
import { TypeOrmProcedureKitNestModule } from '../../src/nest/typeorm-procedure-kit-nest.module.js';
import { TypeOrmProcedureKitNestService } from '../../src/nest/typeorm-procedure-kit-nest.service.js';
import { createLogger } from '../support/helpers.js';

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
    parseInt8AsBigInt: false,
  },
  logger: createLogger(),
} as const;

describe('TypeOrmProcedureKitNestModule', (): void => {
  it('creates a synchronous global dynamic module', (): void => {
    const module = TypeOrmProcedureKitNestModule.forRoot(config);

    expect(module.global).toBe(true);
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

  it('creates an asynchronous global dynamic module', (): void => {
    const useFactory = (): typeof config => config;
    const module = TypeOrmProcedureKitNestModule.forRootAsync({
      useFactory,
      inject: ['TOKEN'],
      imports: [],
    });

    expect(module.global).toBe(true);
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
});
