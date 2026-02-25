import { RelationIdAttribute } from './RelationIdAttribute.js';

export interface RelationIdLoadResult {
  relationIdAttribute: RelationIdAttribute;
  results: Array<unknown>;
}
