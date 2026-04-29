import type { OracleConnectionOptions } from '../driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../driver/postgres/PostgresConnectionOptions.js';

/**
 * DataSourceOptions is an interface with settings and options for specific DataSource.
 */
export type DataSourceOptions = (
  | PostgresConnectionOptions
  | OracleConnectionOptions
) & {
  /**
   * Disables automatic identifier quoting in query builders when true.
   *
   * The kit sets this to true by default during module initialization so
   * generated SQL keeps database identifiers unquoted unless quoting is forced
   * through query-builder escape APIs.
   */
  isQuotingDisabled?: boolean;
};
