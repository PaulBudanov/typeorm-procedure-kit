import { Inject } from '@nestjs/common';

import { SET_SERIALIZER } from '../consts.js';

/**
 * Injects a function that delegates to `TypeOrmProcedureKit.setSerializer()`.
 *
 * Use it to register or override a custom serializer without injecting the
 * whole `TypeOrmProcedureKitNestService`.
 */
export function InjectSetSerializer(): ReturnType<typeof Inject> {
  return Inject(SET_SERIALIZER);
}
