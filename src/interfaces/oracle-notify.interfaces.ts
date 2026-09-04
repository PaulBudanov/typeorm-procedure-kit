export interface IOracleCqnRefetchPlan {
  projection: string;
  tableName: string;
  alias?: string;
  predicate?: string;
}
