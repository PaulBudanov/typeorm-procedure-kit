import type { OracleConnectionOptions } from '../driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../driver/postgres/PostgresConnectionOptions.js';

export type TIdentifierQuoting = 'disabled' | 'enabled';

/**
 * DataSourceOptions is an interface with settings and options for specific DataSource.
 */
export type DataSourceOptions = (
  | PostgresConnectionOptions
  | OracleConnectionOptions
) & {
  /**
   * Controls automatic quoting of physical database, schema, table, and column
   * identifiers in query builders. Aliases are always quoted.
   *
   * Defaults to `disabled` for compatibility with databases whose unquoted
   * identifiers rely on server-side case folding.
   */
  identifierQuoting?: TIdentifierQuoting;
};
