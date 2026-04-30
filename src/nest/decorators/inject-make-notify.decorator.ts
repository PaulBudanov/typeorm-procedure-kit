import { Inject } from '@nestjs/common';

import { MAKE_NOTIFY } from '../consts.js';

/**
 * Injects a function that delegates to `TypeOrmProcedureKit.makeNotify()`.
 *
 * Use it to create a database notification subscription without injecting the
 * whole `TypeOrmProcedureKitNestService`.
 */
export function InjectMakeNotify(): ReturnType<typeof Inject> {
  return Inject(MAKE_NOTIFY);
}
