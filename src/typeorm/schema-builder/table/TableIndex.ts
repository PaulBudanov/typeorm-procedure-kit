import type { IndexMetadata } from '../../metadata/IndexMetadata.js';
import type { TableIndexOptions } from '../options/TableIndexOptions.js';

/**
 * Database's table index stored in this class.
 */
export class TableIndex {
  public readonly '@instanceof' = Symbol.for('TableIndex');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Index name.
   */
  public name?: string;

  /**
   * Columns included in this index.
   */
  public columnNames: Array<string> = [];

  /**
   * Indicates if this index is unique.
   */
  public isUnique: boolean;

  /**
   * The SPATIAL modifier indexes the entire column and does not allow indexed columns to contain NULL values.
   * Works only in MySQL.
   */
  public isSpatial: boolean;

  /**
   * Create the index using the CONCURRENTLY modifier
   * Works only in postgres.
   */
  public isConcurrent: boolean;

  /**
   * The FULLTEXT modifier indexes the entire column and does not allow prefixing.
   * Works only in MySQL.
   */
  public isFulltext: boolean;

  /**
   * NULL_FILTERED indexes are particularly useful for indexing sparse columns, where most rows contain a NULL value.
   * In these cases, the NULL_FILTERED index can be considerably smaller and more efficient to maintain than
   * a normal index that includes NULL values.
   *
   * Works only in Spanner.
   */
  public isNullFiltered: boolean;

  /**
   * Fulltext parser.
   * Works only in MySQL.
   */
  public parser?: string;

  /**
   * Index filter condition.
   */
  public where: string;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options: TableIndexOptions) {
    this.name = options.name;
    this.columnNames = options.columnNames;
    this.isUnique = !!options.isUnique;
    this.isSpatial = !!options.isSpatial;
    this.isConcurrent = !!options.isConcurrent;
    this.isFulltext = !!options.isFulltext;
    this.isNullFiltered = !!options.isNullFiltered;
    this.parser = options.parser;
    this.where = options.where ? options.where : '';
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Creates a new copy of this index with exactly same properties.
   */
  public clone(): TableIndex {
    return new TableIndex({
      name: this.name,
      columnNames: [...this.columnNames],
      isUnique: this.isUnique,
      isSpatial: this.isSpatial,
      isConcurrent: this.isConcurrent,
      isFulltext: this.isFulltext,
      isNullFiltered: this.isNullFiltered,
      parser: this.parser,
      where: this.where,
    } as TableIndexOptions);
  }

  // -------------------------------------------------------------------------
  // Static Methods
  // -------------------------------------------------------------------------

  /**
   * Creates index from the index metadata object.
   */
  public static create(indexMetadata: IndexMetadata): TableIndex {
    return new TableIndex({
      name: indexMetadata.name,
      columnNames: indexMetadata.columns.map((column) => column.databaseName),
      isUnique: indexMetadata.isUnique,
      isSpatial: indexMetadata.isSpatial,
      isConcurrent: indexMetadata.isConcurrent,
      isFulltext: indexMetadata.isFulltext,
      isNullFiltered: indexMetadata.isNullFiltered,
      parser: indexMetadata.parser,
      where: indexMetadata.where,
    } as TableIndexOptions);
  }
}
