import { Inject } from '@nestjs/common';

import { CALL_SQL } from '../consts.js';

/**
 * Injects a function that delegates to
 * `TypeOrmProcedureKit.callSqlTransaction()`.
 *
 * Use it for raw SQL statements that should run through the library execution
 * flow without injecting the whole `TypeOrmProcedureKitNestService`.
 */
export function InjectCallSql(): ReturnType<typeof Inject> {
  return Inject(CALL_SQL);
}
