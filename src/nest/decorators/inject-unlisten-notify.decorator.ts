import { Inject } from '@nestjs/common';

import { UNLISTEN_NOTIFY } from '../consts.js';

/**
 * Injects a function that delegates to `TypeOrmProcedureKit.unlistenNotify()`.
 *
 * Use it to unsubscribe from a database notification channel without injecting
 * the whole `TypeOrmProcedureKitNestService`.
 */
export function InjectUnlistenNotify(): ReturnType<typeof Inject> {
  return Inject(UNLISTEN_NOTIFY);
}
