import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import type { QueryResult } from '../../query-runner/QueryResult.js';

/**
 * Result object returned by UpdateQueryBuilder execution.
 */
export class UpdateResult {
  public static from(queryResult: QueryResult): UpdateResult {
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
  public affected?: number;

  /**
   * Contains inserted entity id.
   * Has entity-like structure (not just column database name and values).
   */
  // identifier: ObjectLiteral[] = [];

  /**
   * Generated values returned by a database.
   * Has entity-like structure (not just column database name and values).
   */
  public generatedMaps: Array<ObjectLiteral> = [];
}
