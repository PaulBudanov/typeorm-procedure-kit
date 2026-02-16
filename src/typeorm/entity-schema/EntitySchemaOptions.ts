import type { TFunction } from '../../types/utility.types.js';
import type { DataSource } from '../data-source/DataSource.js';
import type { OrderByCondition } from '../find-options/OrderByCondition.js';
import type { TableType } from '../metadata/types/TableTypes.js';
import type { TreeMetadataArgs } from '../metadata-args/TreeMetadataArgs.js';
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder.js';

import type { EntitySchemaCheckOptions } from './EntitySchemaCheckOptions.js';
import type { EntitySchemaColumnOptions } from './EntitySchemaColumnOptions.js';
import type { EntitySchemaEmbeddedColumnOptions } from './EntitySchemaEmbeddedColumnOptions.js';
import type { EntitySchemaExclusionOptions } from './EntitySchemaExclusionOptions.js';
import type { EntitySchemaForeignKeyOptions } from './EntitySchemaForeignKeyOptions.js';
import type { EntitySchemaIndexOptions } from './EntitySchemaIndexOptions.js';
import type { EntitySchemaInheritanceOptions } from './EntitySchemaInheritanceOptions.js';
import type { EntitySchemaRelationIdOptions } from './EntitySchemaRelationIdOptions.js';
import type { EntitySchemaRelationOptions } from './EntitySchemaRelationOptions.js';
import type { EntitySchemaUniqueOptions } from './EntitySchemaUniqueOptions.js';

/**
 * Interface for entity metadata mappings stored inside "schemas" instead of models decorated by decorators.
 */
export class EntitySchemaOptions<T> {
  /**
   * Target bind to this entity schema. Optional.
   */
  public target?: TFunction;

  /**
   * Entity name.
   */
  public name!: string;

  /**
   * Table name.
   */
  public tableName?: string;

  /**
   * Database name. Used in MySql and Sql Server.
   */
  public database?: string;

  /**
   * Schema name. Used in Postgres and Sql Server.
   */
  public schema?: string;

  /**
   * Table type.
   */
  public type?: TableType;

  /**
   * Specifies a property name by which queries will perform ordering by default when fetching rows.
   */
  public orderBy?: OrderByCondition;

  /**
   * Entity column's options.
   */
  public columns!: {
    [P in keyof T]?: EntitySchemaColumnOptions;
  };

  /**
   * Entity relation's options.
   */
  public relations?: {
    [P in keyof T]?: EntitySchemaRelationOptions;
  };

  /**
   * Entity relation id options.
   */
  public relationIds?: {
    [P in keyof T]?: EntitySchemaRelationIdOptions;
  };

  /**
   * Entity indices options.
   */
  public indices?: Array<EntitySchemaIndexOptions>;

  /**
   * Entity foreign keys options.
   */
  public foreignKeys?: Array<EntitySchemaForeignKeyOptions>;

  /**
   * Entity uniques options.
   */
  public uniques?: Array<EntitySchemaUniqueOptions>;

  /**
   * Entity check options.
   */
  public checks?: Array<EntitySchemaCheckOptions>;

  /**
   * Entity exclusion options.
   */
  public exclusions?: Array<EntitySchemaExclusionOptions>;

  /**
   * Embedded Entities options
   */
  public embeddeds?: {
    [P in keyof Partial<T>]: EntitySchemaEmbeddedColumnOptions;
  };

  /**
   * Indicates if schema synchronization is enabled or disabled for this entity.
   * If it will be set to false then schema sync will and migrations ignore this entity.
   * By default schema synchronization is enabled for all entities.
   */
  public synchronize?: boolean;

  /**
   * If set to 'true' this option disables Sqlite's default behaviour of secretly creating
   * an integer primary key column named 'rowid' on table creation.
   * @see https://www.sqlite.org/withoutrowid.html.
   */
  public withoutRowid?: boolean;

  /**
   * View expression.
   */
  public expression?:
    | string
    | ((connection: DataSource) => SelectQueryBuilder<unknown>);

  /**
   * Inheritance options.
   */
  public inheritance?: EntitySchemaInheritanceOptions;

  /**
   * Custom discriminator value for Single Table Inheritance.
   */
  public discriminatorValue?: string;

  public trees?: Array<Omit<TreeMetadataArgs, 'target'>>;
}
