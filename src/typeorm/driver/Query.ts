/**
 * This class stores query and its parameters
 */
export class Query {
  public readonly '@instanceof' = Symbol.for('Query');

  public constructor(
    public query: string,
    public parameters?: Array<unknown>
  ) {}
}
