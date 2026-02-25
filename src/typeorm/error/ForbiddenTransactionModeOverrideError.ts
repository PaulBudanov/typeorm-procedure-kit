import { Migration } from '../migration/Migration.js';

import { TypeORMError } from './TypeORMError.js';

/**
 * Thrown when the per-migration transaction mode is overriden but the global transaction mode is set to "all".
 */
export class ForbiddenTransactionModeOverrideError extends TypeORMError {
  public constructor(migrationsOverridingTransactionMode: Array<Migration>) {
    const migrationNames = migrationsOverridingTransactionMode.map(
      (migration) => `"${migration.name}"`
    );

    super(
      `Migrations ${migrationNames.join(
        ', '
      )} override the transaction mode, but the global transaction mode is "all"`
    );
  }
}
