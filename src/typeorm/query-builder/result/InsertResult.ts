import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import type { QueryResult } from '../../query-runner/QueryResult.js';

/**
 * Result object returned by InsertQueryBuilder execution.
 */
export class InsertResult {
  public static from(queryResult: QueryResult): InsertResult {
    const result = new this();
    result.raw = queryResult.raw;
    return result;
  }

  /**
   * Contains inserted entity id.
   * Has entity-like structure (not just column database name and values).
   */
  public identifiers: Array<ObjectLiteral> = [];

  /**
   * Generated values returned by a database.
   * Has entity-like structure (not just column database name and values).
   */
  public generatedMaps: Array<ObjectLiteral> = [];

  /**
   * Raw SQL result returned by executed query.
   */
  public raw: unknown;
}
