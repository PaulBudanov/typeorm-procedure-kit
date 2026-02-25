import type { ObjectLiteral } from '../common/ObjectLiteral.js';
import type { UpsertType } from '../driver/types/UpsertType.js';

import type { Brackets } from './Brackets.js';

export interface InsertOrUpdateOptions {
  /**
   * If true, postgres will skip the update if no values would be changed (reduces writes)
   */
  skipUpdateIfNoValuesChanged?: boolean;
  /**
   * If included, postgres will apply the index predicate to a conflict target (partial index)
   */
  indexPredicate?: string;
  upsertType?: UpsertType;
  overwriteCondition?: {
    where: string | Brackets | ObjectLiteral | Array<ObjectLiteral>;
    parameters?: ObjectLiteral;
  };
}
