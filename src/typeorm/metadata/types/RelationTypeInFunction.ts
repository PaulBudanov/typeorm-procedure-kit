import type { TFunction } from '../../../types/utility.types.js';
import type { EntityTarget } from '../../common/EntityTarget.js';

/**
 * TFunction that returns a type of the field. Returned value must be a class used on the relation.
 */
export type RelationTypeInFunction =
  | ((type?: unknown) => TFunction)
  | EntityTarget<unknown>;
