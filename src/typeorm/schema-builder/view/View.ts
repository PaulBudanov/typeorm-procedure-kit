import type { ObjectLiteral } from '../../common/ObjectLiteral.js';
import type { DataSource } from '../../data-source/DataSource.js';
import type { Driver } from '../../driver/Driver.js';
import type { EntityMetadata } from '../../metadata/EntityMetadata.js';
import type { SelectQueryBuilder } from '../../query-builder/SelectQueryBuilder.js';
import type { ViewOptions } from '../options/ViewOptions.js';
import { TableIndex } from '../table/TableIndex.js';

/**
 * View in the database represented in this class.
 */
export class View {
  public readonly '@instanceof' = Symbol.for('View');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Database name that this view resides in if it applies.
   */
  public database?: string;

  /**
   * Schema name that this view resides in if it applies.
   */
  public schema?: string;

  /**
   * View name
   */
  public name!: string;

  /**
   * Indicates if view is materialized.
   */
  public materialized!: boolean;

  /**
   * View Indices
   */
  public indices: Array<TableIndex> = [];

  /**
   * View definition.
   */
  public expression!:
    | string
    | ((connection: DataSource) => SelectQueryBuilder<ObjectLiteral>);

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options?: ViewOptions) {
    if (options) {
      this.database = options.database;
      this.schema = options.schema;
      this.name = options.name;
      this.expression = options.expression;
      this.materialized = !!options.materialized;
    }
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Clones this table to a new table with all properties cloned.
   */
  public clone(): View {
    return new View({
      database: this.database,
      schema: this.schema,
      name: this.name,
      expression: this.expression,
      materialized: this.materialized,
    } as ViewOptions);
  }

  /**
   * Add index
   */
  public addIndex(index: TableIndex): void {
    this.indices.push(index);
  }

  /**
   * Remove index
   */
  public removeIndex(viewIndex: TableIndex): void {
    const index = this.indices.find((index) => index.name === viewIndex.name);
    if (index) {
      this.indices.splice(this.indices.indexOf(index), 1);
    }
  }

  // -------------------------------------------------------------------------
  // Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates view from a given entity metadata.
   */
  public static create(entityMetadata: EntityMetadata, driver: Driver): View {
    const options: ViewOptions = {
      database: entityMetadata.database,
      schema: entityMetadata.schema,
      name: driver.buildTableName(
        entityMetadata.tableName,
        entityMetadata.schema,
        entityMetadata.database
      ),
      expression: entityMetadata.expression!,
      materialized: entityMetadata.tableMetadataArgs.materialized,
    };

    return new View(options);
  }
}
