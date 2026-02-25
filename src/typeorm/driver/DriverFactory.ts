import type { DataSource } from '../data-source/DataSource.js';
import { MissingDriverError } from '../error/MissingDriverError.js';

import type { Driver } from './Driver.js';
import { OracleDriver } from './oracle/OracleDriver.js';
import { PostgresDriver } from './postgres/PostgresDriver.js';

/**
 * Helps to create drivers.
 */
export class DriverFactory {
  /**
   * Creates a new driver depend on a given connection's driver type.
   */
  public create(connection: DataSource): Driver {
    const { type } = connection.options;
    switch (type) {
      case 'postgres':
        return new PostgresDriver(connection) as unknown as Driver;
      case 'oracle':
        return new OracleDriver(connection) as unknown as Driver;
      default:
        throw new MissingDriverError(type, ['oracle', 'postgres']);
    }
  }
}
