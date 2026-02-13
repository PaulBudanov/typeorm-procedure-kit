import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

import type { OracleConnectionOptions } from '../driver/oracle/OracleConnectionOptions.js';

/**
 * DataSourceOptions is an interface with settings and options for specific DataSource.
 */
export type DataSourceOptions =
  | PostgresConnectionOptions
  | OracleConnectionOptions;
