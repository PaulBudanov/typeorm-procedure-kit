import { Query } from './Query.js';

/**
 * This class stores up and down queries needed for migrations functionality.
 */
export class SqlInMemory {
  public upQueries: Array<Query> = [];
  public downQueries: Array<Query> = [];
}
