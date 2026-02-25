import type { MigrationInterface } from './MigrationInterface.js';

/**
 * Represents entity of the migration in the database.
 */
export class Migration {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Migration id.
   * Indicates order of the executed migrations.
   */
  public id: number | undefined;

  /**
   * Timestamp of the migration.
   */
  public timestamp: number;

  /**
   * Name of the migration (class name).
   */
  public name: string;

  /**
   * Migration instance that needs to be run.
   */
  public instance?: MigrationInterface;

  /**
   * Whether to run this migration within a transaction
   */
  public transaction?: boolean;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(
    id: number | undefined,
    timestamp: number,
    name: string,
    instance?: MigrationInterface,
    transaction?: boolean
  ) {
    this.id = id;
    this.timestamp = timestamp;
    this.name = name;
    this.instance = instance;
    this.transaction = transaction;
  }
}
