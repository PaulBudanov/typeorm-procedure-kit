import { describe, expect, it, vi } from 'vitest';

import { TypeOrmProcedureKitNestService } from '../../src/nest/typeorm-procedure-kit-nest.service.js';
import { createLogger } from '../support/helpers.js';

describe('TypeOrmProcedureKitNestService', (): void => {
  it('logs shutdown signal and delegates to destroy', async (): Promise<void> => {
    const logger = createLogger();
    const service = new TypeOrmProcedureKitNestService({
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
      logger,
    });
    const destroy = vi.spyOn(service, 'destroy').mockResolvedValue(undefined);

    await service.onApplicationShutdown('SIGTERM');

    expect(logger.log).toHaveBeenCalledWith(
      'Application shutdown signal received: SIGTERM'
    );
    expect(destroy).toHaveBeenCalledOnce();
  });
});
