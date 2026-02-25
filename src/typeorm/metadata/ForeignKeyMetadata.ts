import type { NamingStrategyInterface } from '../naming-strategy/NamingStrategyInterface.js';

import { ColumnMetadata } from './ColumnMetadata.js';
import { EntityMetadata } from './EntityMetadata.js';
import type { DeferrableType } from './types/DeferrableType.js';
import type { OnDeleteType } from './types/OnDeleteType.js';
import type { OnUpdateType } from './types/OnUpdateType.js';

/**
 * Contains all information about entity's foreign key.
 */
export class ForeignKeyMetadata {
  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Entity metadata where this foreign key is.
   */
  public entityMetadata: EntityMetadata;

  /**
   * Entity metadata which this foreign key references.
   */
  public referencedEntityMetadata: EntityMetadata;

  /**
   * Array of columns of this foreign key.
   */
  public columns: Array<ColumnMetadata> = [];

  /**
   * Array of referenced columns.
   */
  public referencedColumns: Array<ColumnMetadata> = [];

  /**
   * What to do with a relation on deletion of the row containing a foreign key.
   */
  public onDelete?: OnDeleteType;

  /**
   * What to do with a relation on update of the row containing a foreign key.
   */
  public onUpdate?: OnUpdateType;

  /**
   * When to check the constraints of a foreign key.
   */
  public deferrable?: DeferrableType;

  /**
   * Gets the table name to which this foreign key is referenced.
   */
  public referencedTablePath!: string;

  /**
   * Gets foreign key name.
   * If unique constraint name was given by a user then it stores givenName.
   * If unique constraint name was not given then its generated.
   */
  public name!: string;

  /**
   * Gets array of column names.
   */
  public columnNames: Array<string> = [];

  /**
   * Gets array of referenced column names.
   */
  public referencedColumnNames: Array<string> = [];

  /**
   * User specified unique constraint name.
   */
  public givenName?: string;

  // ---------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------

  public constructor(options: {
    entityMetadata: EntityMetadata;
    referencedEntityMetadata: EntityMetadata;
    namingStrategy?: NamingStrategyInterface;
    columns: Array<ColumnMetadata>;
    referencedColumns: Array<ColumnMetadata>;
    onDelete?: OnDeleteType;
    onUpdate?: OnUpdateType;
    deferrable?: DeferrableType;
    name?: string;
  }) {
    this.entityMetadata = options.entityMetadata;
    this.referencedEntityMetadata = options.referencedEntityMetadata;
    this.columns = options.columns;
    this.referencedColumns = options.referencedColumns;
    this.onDelete = options.onDelete || 'NO ACTION';
    this.onUpdate = options.onUpdate || 'NO ACTION';
    this.deferrable = options.deferrable;
    this.givenName = options.name;
    if (options.namingStrategy) this.build(options.namingStrategy);
  }

  // ---------------------------------------------------------------------
  // Public Methods
  // ---------------------------------------------------------------------

  /**
   * Builds some depend foreign key properties.
   * Must be called after all entity metadatas and their columns are built.
   */
  public build(namingStrategy: NamingStrategyInterface): void {
    this.columnNames = this.columns.map((column) => column.databaseName);
    this.referencedColumnNames = this.referencedColumns.map(
      (column) => column.databaseName
    );
    this.referencedTablePath = this.referencedEntityMetadata.tablePath;
    this.name = this.givenName
      ? this.givenName
      : namingStrategy.foreignKeyName(
          this.entityMetadata.tableName,
          this.columnNames,
          this.referencedEntityMetadata.tableName,
          this.referencedColumnNames
        );
  }
}
