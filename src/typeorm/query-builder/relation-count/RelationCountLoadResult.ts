import { RelationCountAttribute } from './RelationCountAttribute';

export interface RelationCountLoadResult {
  relationCountAttribute: RelationCountAttribute;
  results: Array<{ cnt: any; parentId: any }>;
}
