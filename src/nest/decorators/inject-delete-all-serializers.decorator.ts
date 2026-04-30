import { Inject } from '@nestjs/common';

import { DELETE_ALL_SERIALIZERS } from '../consts.js';

/**
 * Injects a function that delegates to
 * `TypeOrmProcedureKit.deleteAllSerializers()`.
 *
 * Use it to clear all custom serializer mappings without injecting the whole
 * `TypeOrmProcedureKitNestService`.
 */
export function InjectDeleteAllSerializers(): ReturnType<typeof Inject> {
  return Inject(DELETE_ALL_SERIALIZERS);
}
