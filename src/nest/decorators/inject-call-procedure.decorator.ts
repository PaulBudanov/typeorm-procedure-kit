import { Inject } from '@nestjs/common';

import { CALL_PROCEDURE } from '../consts.js';

/**
 * Injects a function that delegates to `TypeOrmProcedureKit.call()`.
 *
 * Use it when a Nest provider needs to execute a configured stored procedure
 * without injecting the whole `TypeOrmProcedureKitNestService`.
 */
export function InjectCallProcedure(): ReturnType<typeof Inject> {
  return Inject(CALL_PROCEDURE);
}
