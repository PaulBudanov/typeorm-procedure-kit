import { EntityManager } from 'typeorm';

/**
 * Calls an array of database commands in a transaction
 * @param {Array<string>} databaseOptionsCommands - array of database commands
 * @param {EntityManager} connection - database connection
 * @returns {Promise<void>} - result of database commands call
 */
//TODO: Migrate to class
export async function callDataBaseOptionsCommands(
  dataBaseOptionsCommands: Array<string>,
  connection: EntityManager,
): Promise<void> {
  await Promise.all(
    dataBaseOptionsCommands.map((command) => {
      return connection.query(command);
    }),
  );
  return;
}
