import { QueryResult } from '../../query-runner/QueryResult.js';

/**
 * Result object returned by DeleteQueryBuilder execution.
 */
export class DeleteResult {
  public static from(queryResult: QueryResult): DeleteResult {
    const result = new this();

    result.raw = queryResult.records;
    result.affected = queryResult.affected;

    return result;
  }

  /**
   * Raw SQL result returned by executed query.
   */
  public raw: unknown;

  /**
   * Number of affected rows/documents
   * Not all drivers support this
   */
  public affected?: number | null;
}
