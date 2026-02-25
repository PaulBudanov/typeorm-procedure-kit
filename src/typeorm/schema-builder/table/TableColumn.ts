import type { TableColumnOptions } from '../options/TableColumnOptions.js';

/**
 * Table's columns in the database represented in this class.
 */
export class TableColumn {
  public readonly '@instanceof' = Symbol.for('TableColumn');

  // -------------------------------------------------------------------------
  // Public Properties
  // -------------------------------------------------------------------------

  /**
   * Column name.
   */
  public name!: string;

  /**
   * Column type.
   */
  public type!: string;

  /**
   * Column's default value.
   */
  public default?: unknown;

  /**
   * ON UPDATE trigger. Works only for MySQL.
   */
  public onUpdate?: string;

  /**
   * Indicates if column is NULL, or is NOT NULL in the database.
   */
  public isNullable = false;

  /**
   * Indicates if column is auto-generated sequence.
   */
  public isGenerated = false;

  /**
   * Specifies generation strategy if this column will use auto increment.
   * `rowid` option supported only in CockroachDB.
   */
  public generationStrategy?: 'uuid' | 'increment' | 'rowid' | 'identity';

  /**
   * Indicates if column is a primary key.
   */
  public isPrimary = false;

  /**
   * Indicates if column has unique value.
   */
  public isUnique = false;

  /**
   * Indicates if column stores array.
   */
  public isArray = false;

  /**
   * Column's comment.
   */
  public comment?: string;

  /**
   * Column type's length. Used only on some column types.
   * For example type = "string" and length = "100" means that ORM will create a column with type varchar(100).
   */
  public length = '';

  /**
   * Column type's display width. Used only on some column types in MySQL.
   * For example, INT(4) specifies an INT with a display width of four digits.
   */
  public width?: number;

  /**
   * Defines column character set.
   */
  public charset?: string;

  /**
   * Defines column collation.
   */
  public collation?: string;

  /**
   * The precision for a decimal (exact numeric) column (applies only for decimal column), which is the maximum
   * number of digits that are stored for the values.
   */
  public precision?: number | null;

  /**
   * The scale for a decimal (exact numeric) column (applies only for decimal column), which represents the number
   * of digits to the right of the decimal point and must not be greater than precision.
   */
  public scale?: number;

  /**
   * Puts ZEROFILL attribute on to numeric column. Works only for MySQL.
   * If you specify ZEROFILL for a numeric column, MySQL automatically adds the UNSIGNED attribute to the column
   */
  public zerofill = false;

  /**
   * Puts UNSIGNED attribute on to numeric column. Works only for MySQL.
   */
  public unsigned = false;

  /**
   * Array of possible enumerated values.
   */
  public enum?: Array<string>;

  /**
   * Exact name of enum
   */
  public enumName?: string;

  /**
   * Name of the primary key constraint for primary column.
   */
  public primaryKeyConstraintName?: string;

  /**
   * Generated column expression.
   */
  public asExpression?: string;

  /**
   * Generated column type.
   */
  public generatedType?: 'VIRTUAL' | 'STORED';

  /**
   * Identity column type. Supports only in Postgres 10+.
   */
  public generatedIdentity?: 'ALWAYS' | 'BY DEFAULT';

  /**
   * Spatial Feature Type (Geometry, Point, Polygon, etc.)
   */
  public spatialFeatureType?: string;

  /**
   * SRID (Spatial Reference ID (EPSG code))
   */
  public srid?: number;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  public constructor(options?: TableColumnOptions) {
    if (options) {
      this.name = options.name;
      this.type = options.type || '';
      this.length = options.length || '';
      this.width = options.width;
      this.charset = options.charset;
      this.collation = options.collation;
      this.precision = options.precision;
      this.scale = options.scale;
      this.zerofill = options.zerofill || false;
      this.unsigned = this.zerofill ? true : options.unsigned || false;
      this.default = options.default;
      this.onUpdate = options.onUpdate;
      this.isNullable = options.isNullable || false;
      this.isGenerated = options.isGenerated || false;
      this.generationStrategy = options.generationStrategy;
      this.generatedIdentity = options.generatedIdentity;
      this.isPrimary = options.isPrimary || false;
      this.isUnique = options.isUnique || false;
      this.isArray = options.isArray || false;
      this.comment = options.comment;
      this.enum = options.enum;
      this.enumName = options.enumName;
      this.primaryKeyConstraintName = options.primaryKeyConstraintName;
      this.asExpression = options.asExpression;
      this.generatedType = options.generatedType;
      this.spatialFeatureType = options.spatialFeatureType;
      this.srid = options.srid;
    }
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Clones this column to a new column with exact same properties as this column has.
   */
  public clone(): TableColumn {
    return new TableColumn({
      name: this.name,
      type: this.type,
      length: this.length,
      width: this.width,
      charset: this.charset,
      collation: this.collation,
      precision: this.precision,
      scale: this.scale,
      zerofill: this.zerofill,
      unsigned: this.unsigned,
      enum: this.enum,
      enumName: this.enumName,
      primaryKeyConstraintName: this.primaryKeyConstraintName,
      asExpression: this.asExpression,
      generatedType: this.generatedType,
      default: this.default,
      onUpdate: this.onUpdate,
      isNullable: this.isNullable,
      isGenerated: this.isGenerated,
      generationStrategy: this.generationStrategy,
      generatedIdentity: this.generatedIdentity,
      isPrimary: this.isPrimary,
      isUnique: this.isUnique,
      isArray: this.isArray,
      comment: this.comment,
      spatialFeatureType: this.spatialFeatureType,
      srid: this.srid,
    } as TableColumnOptions);
  }
}
