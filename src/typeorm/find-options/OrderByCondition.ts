/**
 * Special object that defines order condition for ORDER BY in sql.
 *
 * Example:
 * {
 *  "name": "ASC",
 *  "id": "DESC"
 * }
 *
 * @deprecated
 */
export type OrderByCondition = Record<
  string,
  | ('ASC' | 'DESC')
  | {
      order: 'ASC' | 'DESC';
      nulls?: 'NULLS FIRST' | 'NULLS LAST';
    }
>;
