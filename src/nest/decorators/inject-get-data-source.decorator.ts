import { Inject } from '@nestjs/common';

import { GET_DATA_SOURCE } from '../consts.js';

/**
 * Injects a function that returns `TypeOrmProcedureKit.dataSource`.
 *
 * The DataSource is resolved lazily so Nest can finish module initialization
 * before the getter is called.
 */
export function InjectGetDataSource(): ReturnType<typeof Inject> {
  return Inject(GET_DATA_SOURCE);
}
