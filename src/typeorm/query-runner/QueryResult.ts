/**
 * Result object returned by UpdateQueryBuilder execution.
 */
export class QueryResult<T = unknown> {
  /**
   * Raw SQL result returned by executed query.
   */
  public raw!: T;

  /**
   * Rows
   */
  public records: Array<T> = [];

  /**
   * Number of affected rows/documents
   */
  public affected?: number;
}
