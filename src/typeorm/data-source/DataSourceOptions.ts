import type { OracleConnectionOptions } from '../driver/oracle/OracleConnectionOptions.js';
import type { PostgresConnectionOptions } from '../driver/postgres/PostgresConnectionOptions.js';

/**
 * DataSourceOptions is an interface with settings and options for specific DataSource.
 */
export type DataSourceOptions =
  | PostgresConnectionOptions
  | OracleConnectionOptions;
