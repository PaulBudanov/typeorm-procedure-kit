import { RelationCountAttribute } from './RelationCountAttribute.js';

export interface RelationCountLoadResult {
  relationCountAttribute: RelationCountAttribute;
  results: Array<{ cnt: unknown; parentId: unknown }>;
}
