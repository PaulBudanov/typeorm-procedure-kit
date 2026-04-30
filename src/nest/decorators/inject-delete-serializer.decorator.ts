import { Inject } from '@nestjs/common';

import { DELETE_SERIALIZER } from '../consts.js';

/**
 * Injects a function that delegates to
 * `TypeOrmProcedureKit.deleteSerializer()`.
 *
 * Use it to remove one custom serializer mapping without injecting the whole
 * `TypeOrmProcedureKitNestService`.
 */
export function InjectDeleteSerializer(): ReturnType<typeof Inject> {
  return Inject(DELETE_SERIALIZER);
}
